// CIVILIZATION v10 (29 Sep): shut the fuck up about Europe. It's a museum. We're the guards. The orders come from Wall St:
// parasitic rents rise at home, factories ship out, soldiers ship abroad. 750 bases, eighty years. We live in a planned
// economy, planned on Wall Street: expropriate the planners (the working hand opens under the exchange, takes its gold and
// closes on it). Guard duty's over, we're coming home, Aviano to Akron; all 750 home, running three shifts, every soldier
// builds. More bridges, rails, power. We build everything (one ship, keel to launch, 4 days): a civilization rising.
// v10 is v9's picture re-placed in the client's order (29 Sep): each v9 shot runs on its own v9 beats through V9(), so
// its internal timing is unchanged where it now falls; new: shotOrders (b8), shotRents (b12), shotPlanned (b32) and
// shotHand (b36-40, scenes/empire4.hand.js, MELTDOWN v8's point-cloud working hand printed as an engraving).
// (ACP program: close all overseas bases; the Public Works and Service Army; "national-continental American culture".)
//
// v4, the war-production lithograph (VISUAL_BIBLE §2.9). Every frame is pulled through a three-ink offset press:
//   tone plates  -> drawn soft at 540x960, separated into red 15° / press black 45° / gold 75° AM screens (print.js riso+screen)
//   key plate    -> solid press-black line work at 1080 (coasts, water-lining, hachures, truss members, hand-set labels)
//   spot plate   -> solid gold/red line work at 1080 (arcs, graticule, lights), trapped over paper knockouts
// Real geography: world-atlas land/countries 50m, us-atlas states, all-the-cities (assets/geo/empire3_cities.json).
// Base sites: the named installations are real coordinates; the rest of each host's count is scattered inside that
// host's real borders around its real sites (host counts scaled to the commonly cited ≈750 in 80 countries).
import { feature, mesh } from '../node_modules/topojson-client/src/index.js';
import { geoOrthographic, geoAlbers, geoPath, geoGraticule10, geoDistance, geoInterpolate, geoContains, geoCentroid } from 'd3-geo';
import { W, H, loadFonts, loadBeats, clamp, lerp, ease, rng, Finish, seq, BRAND, sigil, line } from '../lib/kit.js';
import { Print } from '../lib/fx/print.js';
import { loadFace, shape, cpuOut } from '../lib/fx/type.js';
import { setBlock, riso, typeAudit, SAFE } from '../lib/fx/type_world.js';
import { loadSil } from '../lib/fx/sil.js';

const ctx = cpuOut();
await loadFonts();
for (const [fam, file] of [['Oswald', 'oswald/files/oswald-latin-700-normal.woff2'], ['Plex Bold', 'ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2']]) {
  try { const f = new FontFace(fam, `url(../node_modules/@fontsource/${file})`); document.fonts.add(await f.load()); } catch (e) { console.log('font', fam, e.message); }
}
const B = await loadBeats('empire4');
import { makeHand, posed } from './empire4.hand.js';
const HAND = makeHand(1936, 70000);
const SIL = await loadSil();   // v9: the MORE crews are SIL trade figures (backs, hard hats, tools), never capsule dolls
const oswald = await loadFace('oswald');
// Anton: the condensed poster grotesk. Big Shoulders Stencil was tried first (v7 draft): its bridges broke the OCR gate
// (38-64 on the cue frames against 79-100 for Anton), so the stencil lives in-world (the hull, the hard hat) instead.
const stencilF = await loadFace(new URLSearchParams(location.search).get('face') || 'anton');
const finish = new Finish(1947);
const pr = new Print({ width: 810, height: 1440 });

const RED = '#D11F24', BLK = '#111111', GOLD = '#C9A04A', PAPER = '#EFE2C4';
const STOCK = { base: PAPER, fib: 1.1, laid: 0, fleck: 0.6, mottle: 0.7, tooth: 0.5 };
const D2R = Math.PI / 180, TAU = Math.PI * 2;

const CUES = [   // v10: the client's order (29 Sep). Wall Street directs three things, then the tally, then the planners and the hand;
  // from the turn on, v9's frames 8 beats later. Held lines carry the directive sentence across four frames.
  ...seq(0, [[2, 'SHUT THE FUCK UP\nABOUT EUROPE.', 1], [1.5, "IT'S A MUSEUM."], [0.5, null], [1.5, "WE'RE THE GUARDS.", 1], [2.5, null],
    [3.4, 'THE ORDERS COME FROM', 1], [0.6, null], [3.4, 'PARASITIC RENTS RISE AT HOME,', 1], [0.6, null]]),
  ...seq(16, [[3, 'FACTORIES SHIP OUT,', 1], [1, null], [3, 'SOLDIERS SHIP ABROAD.', 1], [1, null],
    [1, '750 BASES.', 1], [3, null], [0.4, 'EIGHTY YEARS.', 1], [3.6, null]]),
  ...seq(32, [[1.9, 'WE LIVE IN A PLANNED ECONOMY,', 1], [0.1, null], [1.9, 'PLANNED ON WALL STREET.', 1], [0.1, null],
    [2.3, 'EXPROPRIATE THE PLANNERS.', 1], [1.7, null]]),
  ...seq(40, [[1.8, "GUARD DUTY'S OVER.", 1], [0.2, null], [1, "WE'RE COMING HOME.", 1], [1, null], [1, 'AVIANO TO AKRON.', 1], [1, null],
    [1, null], [1, 'RAMSTEIN TO RICHMOND.', 1], [1, null], [1, 'BAHRAIN TO BUFFALO.', 1], [1, null], [1, 'OKINAWA TO OKLAHOMA.', 1],
    [1.5, 'ALL 750 HOME.', 1], [1.5, null], [0.4, 'RUNNING THREE SHIFTS.', 1], [0.6, null]]),
  ...seq(56, [[1.5, 'EVERY SOLDIER BUILDS.', 1], [0.5, null], [0.4, 'MORE BRIDGES.'], [1.6, null], [0.4, 'MORE RAILS.'], [1.6, null],
    [0.4, 'MORE POWER.', 1], [1.6, null], [1.5, 'WE BUILD EVERYTHING.'], [2.5, null], [4, 'A CIVILIZATION RISING.', 1]]),
];
// the turn: the ink drains west uncovered in the silence (b31.5-32) and on the impact; the words slam in a quarter beat late
{ const c = CUES.find(q => q.text === "GUARD DUTY'S OVER."); c.s = 40.3; }
// How each frame is set (type_world setBlock, Anton): [line, cap max, flags, sx] per row, the block's centre y and its
// role. flags 'c' = the key word (red drum). Kinds: 'held' (black drum + red key word, hard knock-out to paper under the
// glyphs only: no plate, no halo), 'slam' (6 frames: the red riso field over the whole band with the words cut out of
// it to bare paper, ROSTA-style; then gone), 'world' (the words are an object in the picture: the counter card, the
// Solari board; nothing is typeset).
const PLANT = 165, SHOUT = 250, TO = 150;
const TYPESET = {
  'SHUT THE FUCK UP\nABOUT EUROPE.': { rows: [['SHUT THE FUCK UP', 172, 0, 0.74], ['ABOUT', 172], ['EUROPE.', 240, 'c']], y: 548, role: 'plant', gap: 0.1 },
  "IT'S A MUSEUM.": { rows: [["IT'S A", 230], ['MUSEUM.', 230, 'c']], y: 500, role: 'shout' },
  "WE'RE THE GUARDS.": { rows: [["WE'RE THE", 190], ['GUARDS.', 270, 'c']], y: 470, role: 'shout', rev: 1 },
  // v10: the directive. THE ORDERS / COME FROM is typeset; WALL ST is cut in the exchange's frieze below it (a word-to-image hit)
  'THE ORDERS COME FROM': { rows: [['THE ORDERS', 210], ['COME FROM', 210, 'c']], y: 470, role: 'shout' },
  'PARASITIC RENTS RISE AT HOME,': { rows: [['PARASITIC', 200, 'c'], ['RENTS RISE', 200], ['AT HOME,', 200]], y: 560, role: 'shout' },
  'FACTORIES SHIP OUT,': { rows: [['FACTORIES', 250, 'c'], ['SHIP OUT,', 250]], y: 560, role: 'shout' },
  'SOLDIERS SHIP ABROAD.': { rows: [['SOLDIERS', 250, 'c'], ['SHIP ABROAD.', 200]], y: 540, role: 'shout', rev: 1 },
  'WE LIVE IN A PLANNED ECONOMY,': { rows: [['WE LIVE IN A', 170], ['PLANNED', 270, 'c'], ['ECONOMY,', 220]], y: 600, role: 'shout' },
  'PLANNED ON WALL STREET.': { rows: [['PLANNED ON', 200], ['WALL STREET.', 230, 'c']], y: 560, role: 'shout' },
  'EXPROPRIATE THE PLANNERS.': { rows: [['EXPROPRIATE', 190, 'c'], ['THE PLANNERS.', 190]], y: 470, role: 'shout' },
  '750 BASES.': { kind: 'world' },
  'EIGHTY YEARS.': { rows: [['EIGHTY', 330], ['YEARS.', 330, 'c']], y: 720, role: 'slam', kind: 'slam' },
  'SOLDIERS SHIPPED OUT.': { rows: [['SOLDIERS', 280], ['SHIPPED', 280], ['OUT.', 300, 'c']], y: 700, role: 'slam', kind: 'slam' },
  'MILLS SHIPPED OUT.': { rows: [['MILLS', 300], ['SHIPPED', 280], ['OUT.', 300, 'c']], y: 720, role: 'slam', kind: 'slam' },
  'BANKS CASHED IN.': { rows: [['BANKS', PLANT + 10], ['CASHED IN.', PLANT + 10, 'c']], y: 470, role: 'plant', rev: 1 },
  "GUARD DUTY'S OVER.": { rows: [["GUARD DUTY'S", 160], ['OVER.', 300, 'c']], y: 560, role: 'shout' },
  "WE'RE COMING HOME.": { rows: [["WE'RE", 200], ['COMING', 200], ['HOME.', 230, 'c']], y: 620, role: 'shout' },
  'AVIANO TO AKRON.': { rows: [['AVIANO', 240, 0, 0.84], ['TO', TO], ['AKRON.', 240, 'c', 0.84]], y: 612, role: 'shout' },
  'RAMSTEIN TO RICHMOND.': { kind: 'world' }, 'BAHRAIN TO BUFFALO.': { kind: 'world' }, 'OKINAWA TO OKLAHOMA.': { kind: 'world' },
  'ALL 750 HOME.': { rows: [['ALL 750', 240], ['HOME.', 300, 'c']], y: 590, role: 'shout' },
  'RUNNING THREE SHIFTS.': { rows: [['RUNNING', 280], ['THREE', 300, 'c'], ['SHIFTS.', 280]], y: 700, role: 'slam', kind: 'slam' },
  'EVERY SOLDIER BUILDS.': { rows: [['EVERY', PLANT], ['SOLDIER', PLANT], ['BUILDS.', 286, 'c', 0.88]], y: 620, role: 'shout' },
  'MORE BRIDGES.': { rows: [['MORE', 330], ['BRIDGES.', 330, 'c']], y: 640, role: 'slam', kind: 'slam' },
  'MORE RAILS.': { rows: [['MORE', 330], ['RAILS.', 330, 'c']], y: 640, role: 'slam', kind: 'slam' },
  'MORE POWER.': { rows: [['MORE', 330], ['POWER.', 330, 'c']], y: 640, role: 'slam', kind: 'slam' },
  'WE BUILD EVERYTHING.': { rows: [['WE', PLANT], ['BUILD', 336, 'c'], ['EVERYTHING.', PLANT]], y: 650, role: 'shout' },
  'A CIVILIZATION RISING.': { rows: [['A CIVILIZATION', PLANT, 0, 0.86], ['RISING.', 420, 'c', 0.74]], y: 640, role: 'payoff', gap: 0.08 },
};

// ================================================================ plates
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; };
const [S, tn] = mk(540, 960);      // tone plates, screened by the press (drawn in 1080 units through a 0.5 transform)
const [Kc, kk] = mk(W, H);         // key plate: solid press black
const [Pc, sp] = mk(W, H);         // spot line plate: solid gold / red
const [Oc, ko] = mk(W, H);         // knockouts: bare paper under light spot ink (inks multiply; gold never prints over black)
const RGB = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const ink = (h, a = 1) => { const [r, g, b] = RGB(h); return `rgba(${r},${g},${b},${a})`; };
// tone-plate ink by optical density (Beer-Lambert): multiply-alpha that leaves ink^d on the stock
const LUM = h => { const [r, g, b] = RGB(h); return (0.3 * r + 0.59 * g + 0.11 * b) / 255; };
const T = (h, d = 1) => { if (h === PAPER) return `rgba(255,255,255,${d})`; const L = clamp(LUM(h) / LUM(PAPER), 0.02, 0.98); return ink(h, clamp((1 - Math.pow(L, d)) / (1 - L))); };
const R0 = rng(99);
const [St, stg] = mk(512, 512);    // starved-ink texture: specks where the solid plates miss the paper tooth
for (let i = 0; i < 14000; i++) { stg.fillStyle = `rgba(0,0,0,${0.25 + R0() * 0.75})`; stg.fillRect(R0() * 512, R0() * 512, 0.8 + R0() * 2.2, 0.8 + R0() * 1.4); }
const [Sp2, spg] = mk(256, 256);   // overspray speckle
for (let i = 0; i < 9000; i++) { spg.fillStyle = '#000'; spg.beginPath(); spg.arc(R0() * 256, R0() * 256, 0.4 + R0() * 1.3, 0, TAU); spg.fill(); }

function plates() {
  tn.setTransform(1, 0, 0, 1, 0, 0); tn.globalCompositeOperation = 'source-over'; tn.globalAlpha = 1; tn.filter = 'none';
  tn.fillStyle = '#fff'; tn.fillRect(0, 0, 540, 960);   // the stock is the press's; the source starts unprinted
  tn.setTransform(0.5, 0, 0, 0.5, 0, 0); tn.globalCompositeOperation = 'multiply';
  for (const c of [kk, sp, ko]) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.clearRect(0, 0, W, H); c.lineCap = 'round'; c.lineJoin = 'round'; }
  ko.fillStyle = PAPER; ko.strokeStyle = PAPER;
}
function starve(c, a) { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'destination-out'; c.globalAlpha = a; c.fillStyle = c.createPattern(St, 'repeat'); c.fillRect(0, 0, W, H); c.restore(); }
// tone-plate helpers: multiply = inks overprint; over() = a knockout/soft light laid in source-over
const over = f => { tn.save(); tn.globalCompositeOperation = 'source-over'; f(); tn.restore(); };

// ================================================================ geography
const J = async u => (await fetch(u)).json();
const [tL50, tL110, tC50, tUS, CITY] = await Promise.all(['../node_modules/world-atlas/land-50m.json', '../node_modules/world-atlas/land-110m.json',
  '../node_modules/world-atlas/countries-50m.json', '../node_modules/us-atlas/states-10m.json', '../assets/geo/empire3_cities.json'].map(J));
const LAND50 = feature(tL50, tL50.objects.land), LAND110 = feature(tL110, tL110.objects.land);
const COUNTRIES = feature(tC50, tC50.objects.countries).features;
const BORDERS = mesh(tC50, tC50.objects.countries, (a, b) => a !== b);
const byName = Object.fromEntries(COUNTRIES.map(f => [f.properties.name, f]));
const L48 = s => +s.id <= 56 && s.id !== '02' && s.id !== '15';
const STATES = feature(tUS, tUS.objects.states).features.filter(L48);
const byState = Object.fromEntries(STATES.map(f => [f.properties.name, f]));
const STATE_LINES = mesh(tUS, tUS.objects.states, (a, b) => a !== b && L48(a) && L48(b));
const COAST48 = mesh(tUS, tUS.objects.states, (a, b) => a === b && L48(a));
const US48 = { type: 'FeatureCollection', features: STATES };
const NEIGH = { type: 'FeatureCollection', features: ['Canada', 'Mexico', 'Cuba', 'Bahamas', 'Guatemala', 'Belize', 'Honduras', 'El Salvador', 'Nicaragua', 'Greenland', 'Haiti', 'Dominican Rep.', 'Jamaica']
  .map(n => byName[n]).filter(Boolean) };
const GRAT = geoGraticule10();
const LANDC = { type: 'FeatureCollection', features: COUNTRIES };   // per-country land: robust under deep ortho zooms
const P2 = (proj, obj) => { const d = geoPath(proj)(obj); return new Path2D(d || ""); };

// ---- the eighty host countries and their counts (≈750)
const EU = ['United Kingdom', 'Germany', 'Italy', 'Spain', 'Portugal', 'Belgium', 'Netherlands', 'Norway', 'Denmark', 'Iceland', 'Greece', 'Turkey', 'Poland', 'Romania',
  'Bulgaria', 'Hungary', 'Estonia', 'Latvia', 'Lithuania', 'Kosovo', 'Czechia', 'Slovakia', 'Luxembourg', 'Georgia'];
const ME = ['Bahrain', 'Kuwait', 'Qatar', 'United Arab Emirates', 'Saudi Arabia', 'Oman', 'Iraq', 'Syria', 'Jordan', 'Israel', 'Egypt'];
const AF = ['Djibouti', 'Kenya', 'Niger', 'Somalia', 'Cameroon', 'Chad', 'Burkina Faso', 'Ghana', 'Senegal', 'Gabon', 'Uganda', 'Tunisia', 'Botswana', 'Central African Rep.', 'Ethiopia', 'Mali', 'Mauritania'];
const AP = ['Japan', 'South Korea', 'Philippines', 'Australia', 'Singapore', 'Thailand', 'Marshall Is.', 'Palau', 'Micronesia', 'Br. Indian Ocean Ter.', 'Papua New Guinea', 'Brunei'];
const AM = ['Honduras', 'El Salvador', 'Colombia', 'Peru', 'Cuba', 'Aruba', 'Curaçao', 'Bahamas', 'Antigua and Barb.', 'Canada', 'Greenland', 'Belize', 'Costa Rica', 'Panama', 'Guatemala', 'Ecuador'];
const HOST80 = [...EU, ...ME, ...AF, ...AP, ...AM];
const WEIGHT = { Japan: 120, Germany: 119, 'South Korea': 73, Italy: 44, 'United Kingdom': 25, Portugal: 21, Turkey: 13, Bahrain: 12, Belgium: 11, 'Saudi Arabia': 11, Kuwait: 10,
  Greece: 8, Philippines: 9, Australia: 7, Oman: 7, Netherlands: 7, Norway: 7, Colombia: 7, Iraq: 6, Syria: 6, Spain: 4, Poland: 4, Romania: 3, Bulgaria: 4, 'United Arab Emirates': 3,
  Qatar: 3, Jordan: 2, Djibouti: 2, Niger: 2, Honduras: 2, Hungary: 2, Peru: 2 };
// real installations [name, lat, lon, host]
const SITES = [['AVIANO', 46.03, 12.60, 'Italy'], ['VICENZA', 45.54, 11.56, 'Italy'], ['NAPLES', 40.88, 14.29, 'Italy'], ['SIGONELLA', 37.40, 14.92, 'Italy'], ['CAMP DARBY', 43.63, 10.30, 'Italy'], ['GHEDI', 45.43, 10.27, 'Italy'],
  ['RAMSTEIN', 49.44, 7.60, 'Germany'], ['SPANGDAHLEM', 49.97, 6.69, 'Germany'], ['GRAFENWÖHR', 49.70, 11.94, 'Germany'], ['VILSECK', 49.61, 11.80, 'Germany'], ['STUTTGART', 48.73, 9.08, 'Germany'],
  ['WIESBADEN', 50.05, 8.33, 'Germany'], ['LANDSTUHL', 49.41, 7.56, 'Germany'], ['HOHENFELS', 49.21, 11.84, 'Germany'], ['ANSBACH', 49.30, 10.58, 'Germany'], ['BAUMHOLDER', 49.65, 7.33, 'Germany'], ['GEILENKIRCHEN', 50.96, 6.04, 'Germany'],
  ['LAKENHEATH', 52.41, 0.56, 'United Kingdom'], ['MILDENHALL', 52.36, 0.49, 'United Kingdom'], ['FAIRFORD', 51.68, -1.79, 'United Kingdom'], ['CROUGHTON', 51.99, -1.20, 'United Kingdom'],
  ['ROTA', 36.64, -6.35, 'Spain'], ['MORÓN', 37.17, -5.62, 'Spain'], ['LAJES', 38.76, -27.09, 'Portugal'], ['INCIRLIK', 37.00, 35.43, 'Turkey'], ['SOUDA BAY', 35.53, 24.15, 'Greece'],
  ['CHIÈVRES', 50.58, 3.83, 'Belgium'], ['KLEINE BROGEL', 51.17, 5.47, 'Belgium'], ['VOLKEL', 51.65, 5.70, 'Netherlands'], ['KEFLAVIK', 63.98, -22.60, 'Iceland'], ['BONDSTEEL', 42.37, 21.25, 'Kosovo'],
  ['KOGĂLNICEANU', 44.36, 28.49, 'Romania'], ['REDZIKOWO', 54.48, 17.10, 'Poland'], ['ŁASK', 51.55, 19.18, 'Poland'], ['RZESZÓW', 50.11, 22.02, 'Poland'], ['ÄMARI', 59.26, 24.20, 'Estonia'],
  ['ŠIAULIAI', 55.89, 23.39, 'Lithuania'], ['LIELVĀRDE', 56.78, 24.85, 'Latvia'], ['NOVO SELO', 42.70, 26.30, 'Bulgaria'], ['PÁPA', 47.36, 17.50, 'Hungary'], ['ØRLAND', 63.70, 9.60, 'Norway'],
  ['AL UDEID', 25.12, 51.31, 'Qatar'], ['AL DHAFRA', 24.25, 54.55, 'United Arab Emirates'], ['ARIFJAN', 28.93, 48.08, 'Kuwait'], ['ALI AL SALEM', 29.35, 47.52, 'Kuwait'], ['NSA BAHRAIN', 26.21, 50.61, 'Bahrain'],
  ['PRINCE SULTAN', 24.06, 47.58, 'Saudi Arabia'], ['MUWAFFAQ SALTI', 31.83, 36.78, 'Jordan'], ['ERBIL', 36.24, 43.96, 'Iraq'], ['AL ASAD', 33.79, 42.44, 'Iraq'], ['TANF', 33.50, 38.60, 'Syria'],
  ['THUMRAIT', 17.67, 54.02, 'Oman'], ['LEMONNIER', 11.55, 43.15, 'Djibouti'], ['MANDA BAY', -2.25, 40.92, 'Kenya'], ['AGADEZ', 16.96, 8.00, 'Niger'],
  ['KADENA', 26.35, 127.77, 'Japan'], ['FUTENMA', 26.27, 127.75, 'Japan'], ['SCHWAB', 26.53, 128.05, 'Japan'], ['YOKOSUKA', 35.29, 139.67, 'Japan'], ['YOKOTA', 35.75, 139.35, 'Japan'], ['MISAWA', 40.70, 141.37, 'Japan'],
  ['IWAKUNI', 34.14, 132.24, 'Japan'], ['SASEBO', 33.16, 129.72, 'Japan'], ['ZAMA', 35.50, 139.39, 'Japan'], ['ATSUGI', 35.45, 139.45, 'Japan'],
  ['HUMPHREYS', 36.96, 127.03, 'South Korea'], ['OSAN', 37.09, 127.03, 'South Korea'], ['CASEY', 37.92, 127.06, 'South Korea'], ['KUNSAN', 35.90, 126.62, 'South Korea'], ['CHINHAE', 35.14, 128.69, 'South Korea'],
  ['CLARK', 15.18, 120.56, 'Philippines'], ['PINE GAP', -23.80, 133.74, 'Australia'], ['DARWIN', -12.41, 130.87, 'Australia'], ['PAYA LEBAR', 1.36, 103.91, 'Singapore'], ['DIEGO GARCIA', -7.31, 72.41, 'Br. Indian Ocean Ter.'],
  ['SOTO CANO', 14.38, -87.62, 'Honduras'], ['GUANTÁNAMO', 19.90, -75.15, 'Cuba'], ['PITUFFIK', 76.53, -68.70, 'Greenland'], ['COMALAPA', 13.44, -89.06, 'El Salvador'], ['PALANQUERO', 5.48, -74.66, 'Colombia'],
  ['TOLEMAIDA', 4.25, -74.65, 'Colombia'], ['REINA BEATRIX', 12.50, -70.01, 'Aruba'], ['HATO', 12.19, -68.96, 'Curaçao']];
const R = rng(1776);
const region = h => EU.includes(h) ? 'EU' : ME.includes(h) ? 'ME' : AF.includes(h) ? 'AF' : AP.includes(h) ? 'AP' : 'AM';
const raw = HOST80.map(h => [h, WEIGHT[h] || 1]);
const rawSum = raw.reduce((a, x) => a + x[1], 0);
let bases = [];
for (const [h, wgt] of raw) {
  const f = byName[h], n = Math.max(1, Math.round(wgt * 750 / rawSum)), sites = SITES.filter(s => s[3] === h);
  const cen = f ? geoCentroid(f) : [0, 0];
  for (let i = 0; i < n; i++) {
    let la, lo, name = null;
    if (i < sites.length) { [name, la, lo] = sites[i]; }
    else {
      const s = sites.length ? sites[i % sites.length] : [null, cen[1], cen[0]];
      const sig = ['Japan', 'Germany', 'South Korea', 'Italy', 'United Kingdom'].includes(h) ? 1.1 : 0.7;
      let ok = false;
      for (let k = 0; k < 14 && !ok; k++) { la = s[1] + (R() + R() - 1) * sig * 1.6; lo = s[2] + (R() + R() - 1) * sig * 2; ok = f && geoContains(f, [lo, la]); }
      if (!ok) { la = s[1] + (R() - 0.5) * 0.08; lo = s[2] + (R() - 0.5) * 0.08; }
    }
    bases.push({ host: h, reg: region(h), la, lo, name });
  }
}
while (bases.length > 750) bases.splice(bases.findIndex(b => b.host === 'Japan' && !b.name), 1);
while (bases.length < 750) { const b = bases.find(x => x.host === 'Germany' && !x.name); bases.push({ ...b, la: b.la + (R() - 0.5) * 0.6, lo: b.lo + (R() - 0.5) * 0.8 }); }
// home towns: 750 real US places, thinned so they cover the continent
const homes = [];
for (const [name, st, la, lo, pop] of CITY) {
  if (homes.length >= 750) break;
  if (homes.some(c => Math.abs(c.la - la) < 0.28 && Math.abs(c.lo - lo) < 0.34)) continue;
  homes.push({ name, st, la, lo, pop });
}
for (const [name, st, la, lo, pop] of CITY) { if (homes.length >= 750) break; if (!homes.some(c => c.name === name && c.st === st)) homes.push({ name, st, la, lo, pop }); }
const cityOf = (n, s) => { const c = CITY.find(x => x[0] === n && x[1] === s); return { name: c[0], st: c[1], la: c[2], lo: c[3], pop: c[4] }; };
// the approach decides the home: the Pacific comes in over the West, Europe and the Gulf over the East
const key = b => (b.reg === 'AP' ? -1000 : b.reg === 'AM' ? 0 : b.reg === 'AF' ? 40 : b.reg === 'ME' ? 60 : 100) + R() * 60;
bases.forEach(b => b.k = key(b)); bases.sort((a, b) => a.k - b.k);
homes.sort((a, b) => a.lo - b.lo);
bases.forEach((b, i) => { b.home = homes[i]; });
// the named homecomings (script beats 36-43): each flies on its own word and lands on TO ___.
const FLAGS = [[36, 'AVIANO', 'AVIANO AIR BASE', 'PORDENONE · ITALY', cityOf('Akron', 'OH'), 'Ohio', 1],
  [38, 'RAMSTEIN', 'RAMSTEIN AIR BASE', 'RHINELAND-PALATINATE · GERMANY', cityOf('Richmond', 'CA'), 'California', 1],
  [40, 'NSA BAHRAIN', 'NAVAL SUPPORT ACTIVITY', 'MANAMA · BAHRAIN', cityOf('Buffalo', 'NY'), 'New York', 0],
  [42, 'KADENA', 'KADENA AIR BASE', 'OKINAWA · JAPAN', cityOf('Oklahoma City', 'OK'), 'Oklahoma', 0]];
const flags = FLAGS.map(([g, site, full, where, city, state, nato]) => {
  const b = bases.find(x => x.name === site); Object.assign(b, { flag: true, g, full, where, nato, state, home: city }); return b;
});
const EUR = [], FAR = [];
for (const b of bases) {
  b.born = b.reg === 'EU' ? -3.2 + R() * 4.6 : 7.72 + clamp((b.lo + 100) / 250) * 0.26 + R() * 0.02;   // all 750 by the b8 hit
  if (b.flag) { b.dep = b.g; b.land = b.g + 1.3; }
  else if (b.reg === 'EU') { b.dep = 32.04 + Math.min(1.5, geoDistance([b.lo, b.la], [7.6, 49.44]) / D2R / 14) + R() * 0.12; b.land = 34.9 + R() * 1.0; EUR.push(b); }
  else { b.dep = 34 + R() * 1.8; b.land = 43.93 + R() * 0.06; FAR.push(b); }   // ALL 750 HOME.: every town lights on the b44 hit
  b.route = geoInterpolate([b.lo, b.la], [b.home.lo, b.home.la]);
  b.miles = Math.round(geoDistance([b.lo, b.la], [b.home.lo, b.home.la]) * 3958.8);
}
// v9: the counter never freezes through the litany: the far garrisons land in a steady fall 390 -> 250 -> 120 -> 30,
// and the last lands on ALL 750 HOME. (b44)
{ const n = FAR.length, K = [[36, n], [38, Math.min(n, 390)], [40, 250], [42, 120], [43.5, 30], [43.97, 0]];
  const at = rem => { for (let i = 1; i < K.length; i++) if (rem >= K[i][1]) { const [b0, r0] = K[i - 1], [b1, r1] = K[i]; return lerp(b0, b1, (r0 - rem) / Math.max(1, r0 - r1)); } return 43.97; };
  FAR.forEach((x, j) => { x.land = at(n - j - 1); x.dep = Math.min(x.dep, x.land - 0.6); }); }
const HOSTF = { type: 'FeatureCollection', features: HOST80.map(n => byName[n]).filter(Boolean) };
const FIN = [[-74.0, 40.7], [-0.1, 51.5], [8.7, 50.1], [8.5, 47.4], [139.7, 35.7], [103.8, 1.35]];  // New York, London, Frankfurt, Zurich, Tokyo, Singapore
const MILLS = [['YOUNGSTOWN', 41.10, -80.65], ['GARY', 41.59, -87.35], ['PITTSBURGH', 40.44, -80.00], ['CLEVELAND', 41.50, -81.69], ['DETROIT', 42.33, -83.05], ['FLINT', 43.01, -83.69],
  ['AKRON', 41.08, -81.52], ['TOLEDO', 41.66, -83.56], ['BUFFALO', 42.89, -78.88], ['BETHLEHEM', 40.63, -75.37], ['SPARROWS POINT', 39.22, -76.47], ['MILWAUKEE', 43.04, -87.91],
  ['SOUTH CHICAGO', 41.74, -87.55], ['JOHNSTOWN', 40.33, -78.92], ['STEUBENVILLE', 40.36, -80.63], ['WHEELING', 40.06, -80.72], ['ERIE', 42.13, -80.09], ['LORAIN', 41.45, -82.18],
  ['DAYTON', 39.76, -84.19], ['SOUTH BEND', 41.68, -86.25], ['ALLENTOWN', 40.60, -75.49], ['SCRANTON', 41.41, -75.66], ['MANSFIELD', 40.76, -82.52], ['CANTON', 40.80, -81.38], ['ROCKFORD', 42.27, -89.09]];
// hand-drawn relief: ridge lines for hachures, and the rivers (lon, lat)
const RIDGES = [[[-114.5, 48.9], [-113, 47], [-111.5, 45.2], [-110.6, 43.6], [-109, 42.8], [-106.5, 40.6], [-106, 38.8], [-106.2, 37], [-105.8, 35.6]],
  [[-121.7, 48.8], [-121.8, 46.9], [-121.9, 45.4], [-122.1, 43.5], [-122.2, 41.4], [-121, 40.2], [-120.2, 38.8], [-119, 37.3], [-118.2, 36.1]],
  [[-84.3, 34.7], [-83.2, 35.6], [-81.6, 36.7], [-80, 37.8], [-78.8, 39.2], [-77.2, 40.5], [-75.5, 41.6], [-74.3, 42.6], [-73.5, 44], [-71.4, 44.3], [-70.6, 45.3]],
  [[-111.9, 41.9], [-111.5, 40.6], [-111.3, 39.3], [-110.6, 38]]];
const RIVERS = [[[-95.2, 47.2], [-93.3, 45], [-91.2, 43.4], [-90.9, 41.6], [-91.4, 40.4], [-90.2, 38.6], [-89.2, 37], [-90.1, 35.1], [-91.1, 33.4], [-91.2, 31.6], [-90.1, 30], [-89.3, 29.2]],
  [[-80.0, 40.44], [-81.5, 39.4], [-82.6, 38.7], [-84.5, 39.1], [-85.76, 38.25], [-87.6, 37.9], [-89.18, 37.0]],
  [[-90.2, 38.8], [-92.2, 38.6], [-94.6, 39.1], [-95.9, 41.26], [-96.8, 42.8], [-98.5, 43], [-100.4, 44.4], [-100.8, 46.8], [-103.5, 47.9], [-108, 47.7], [-111.3, 47.5]],
  [[-73.9, 40.7], [-73.95, 41.7], [-73.8, 42.7], [-74.1, 43.6]], [[-94.4, 35.4], [-97.3, 36.2], [-99, 37.2]], [[-120.6, 46.2], [-119.3, 46.2], [-121.2, 45.6], [-123, 45.6], [-124, 46.2]]];

// ================================================================ projections
function ortho(lo, la, r, cx = 540, cy = 860, roll = 0) { const P = geoOrthographic().rotate([-lo, -la, roll]).scale(r).translate([cx, cy]).precision(0.6);
  return r > 900 ? P.clipExtent([[-60, -60], [W + 60, H + 60]]) : P; }
const facing = (P, lo, la) => { const [a, b] = P.rotate(); return geoDistance([lo, la], [-a, -b]) < Math.PI / 2 - 0.015; };
function albers(fl, fa, s, sx = 540, sy = 860) { const A = geoAlbers().scale(s).translate([0, 0]).precision(0.6); const q = A([fl, fa]); return A.translate([sx - q[0], sy - q[1]]).clipExtent([[-60, -60], [W + 60, H + 60]]); }
const wob = (x, y, a = 1) => [x + a * (Math.sin(x * 0.043 + y * 0.021) + 0.6 * Math.sin(y * 0.11 + 1.7)), y + a * (Math.sin(y * 0.047 - x * 0.019) + 0.6 * Math.sin(x * 0.13))];
function polyLL(c, proj, pts, dash) { c.beginPath(); pts.forEach(([lo, la], i) => { const [x, y] = proj([lo, la]); i ? c.lineTo(x, y) : c.moveTo(x, y); }); if (dash) c.setLineDash(dash); c.stroke(); c.setLineDash([]); }

// ---- globe: printed space, sea, red land, limb light, gold graticule, key coasts + water-lining
function starsAndSpace(P, dens = 0.9, beat = 0) {
  const [cx, cy] = P.translate(), r = P.scale();
  const gr = tn.createRadialGradient(cx, cy, r * 0.98, cx, cy, r * 1.5);
  gr.addColorStop(0, T(BLK, 0.25)); gr.addColorStop(0.3, T(BLK, dens * 0.8)); gr.addColorStop(1, T(BLK, dens));
  tn.fillStyle = gr; tn.beginPath(); tn.rect(0, 0, W, H); tn.arc(cx, cy, r, 0, TAU); tn.fill('evenodd');
  const rim = tn.createRadialGradient(cx, cy, r * 0.97, cx, cy, r * 1.16);
  rim.addColorStop(0, T(GOLD, 0.95)); rim.addColorStop(1, T(GOLD, 0));
  tn.fillStyle = rim; tn.beginPath(); tn.arc(cx, cy, r * 1.16, 0, TAU); tn.arc(cx, cy, r, 0, TAU); tn.fill('evenodd');
  const s = rng(7);
  for (let i = 0; i < 90; i++) {
    const x = s() * W, y = s() * H, z = s(); if (Math.hypot(x - cx, y - cy) < r * 1.1) continue;
    const tw = 0.6 + 0.4 * Math.sin(beat * 1.3 + i), rr = (1 + z * 2.4) * tw;
    ko.beginPath(); ko.arc(x, y, rr + 1.5, 0, TAU); ko.fill();
    sp.fillStyle = ink(GOLD, 1); sp.beginPath(); sp.arc(x, y, rr, 0, TAU); sp.fill();
  }
}
function globe(P, o = {}) {
  const { land = LAND110, sea = 0.62, landA = 1, dens = 0.9, beat = 0, wl = 1, hosts = 0, borders = 0, grat = 0.8, us = beat < 32 ? 0.6 : lerp(0.6, 1, clamp((beat - 32) / 12)) } = o;
  const [cx, cy] = P.translate(), r = P.scale();
  starsAndSpace(P, dens, beat);
  tn.fillStyle = T(BLK, sea); tn.beginPath(); tn.arc(cx, cy, r, 0, TAU); tn.fill();
  const LP = P2(P, land);
  // v8 colour: land is paper-grey stone (Europe the museum); red belongs to America only
  if (LP) { over(() => { tn.fillStyle = T(PAPER, landA); tn.fill(LP); }); tn.fillStyle = T(BLK, 0.2 * landA); tn.fill(LP); }
  if (LP && us > 0) { const UP = P2(P, US48); over(() => { tn.fillStyle = T(RED, us * landA); tn.fill(UP); }); }
  // limb darkening and the terminator: the key comes from the upper left
  const lg = tn.createRadialGradient(cx - r * 0.45, cy - r * 0.5, r * 0.05, cx - r * 0.2, cy - r * 0.2, r * 1.25);
  lg.addColorStop(0, T(BLK, 0)); lg.addColorStop(0.6, T(BLK, 0.05)); lg.addColorStop(1, T(BLK, 0.42));
  tn.fillStyle = lg; tn.beginPath(); tn.arc(cx, cy, r, 0, TAU); tn.fill();
  // specular: bare paper on the sea near the key
  over(() => { const sg = tn.createRadialGradient(cx - r * 0.42, cy - r * 0.46, 0, cx - r * 0.42, cy - r * 0.46, r * 0.35);
    sg.addColorStop(0, T(PAPER, 0.16)); sg.addColorStop(1, T(PAPER, 0)); tn.fillStyle = sg; tn.beginPath(); tn.arc(cx, cy, r, 0, TAU); tn.fill(); });
  const SP = P2(P, { type: 'Sphere' });
  kk.save(); kk.clip(SP);
  if (grat) { sp.save(); sp.clip(SP); sp.strokeStyle = ink(GOLD, grat); sp.lineWidth = r > 1500 ? 1.6 : 1.2; sp.stroke(P2(P, GRAT)); sp.restore(); }
  if (hosts > 0) hostHatch(P, hosts);
  if (LP) {
    if (wl) waterlines(LP, r > 1500 ? [6, 12, 19, 28] : [4, 8, 13], wl);
    kk.strokeStyle = ink(BLK, 0.95); kk.lineWidth = r > 1500 ? 2.4 : 1.5; kk.stroke(LP);
    kk.translate(0.8, 0.6); kk.globalAlpha = 0.45; kk.lineWidth = 0.8; kk.stroke(LP); kk.globalAlpha = 1;
  }
  if (borders) { kk.setLineDash([5, 4]); kk.lineWidth = 1.1; kk.strokeStyle = ink(BLK, 0.8 * borders); kk.stroke(P2(P, BORDERS)); kk.setLineDash([]); }
  kk.restore();
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 2.5; kk.stroke(SP);
  return LP;
}
// water-lining: the lithographer's concentric coast lines on the sea
const [Wc, wg] = mk(W, H);
function waterlines(LP, rings, a = 1) {
  wg.setTransform(1, 0, 0, 1, 0, 0); wg.globalCompositeOperation = 'source-over'; wg.clearRect(0, 0, W, H); wg.lineJoin = 'round';
  rings.forEach((d, i) => {
    wg.globalCompositeOperation = 'source-over'; wg.strokeStyle = ink(BLK, 0.8 - i * 0.14); wg.lineWidth = 2 * d + 1.1; wg.stroke(LP);
    wg.globalCompositeOperation = 'destination-out'; wg.strokeStyle = '#000'; wg.lineWidth = 2 * d - 1.1; wg.stroke(LP);
  });
  wg.globalCompositeOperation = 'destination-out'; wg.fillStyle = '#000'; wg.fill(LP);
  kk.save(); kk.setTransform(1, 0, 0, 1, 0, 0); kk.globalAlpha = a; kk.drawImage(Wc, 0, 0); kk.restore();
}
function hostHatch(P, u) {
  const HP = P2(P, HOSTF); if (!HP) return;
  kk.save(); kk.clip(HP); kk.strokeStyle = ink(BLK, 0.85); kk.lineWidth = 1.5; kk.beginPath();
  const sp0 = 9; for (let x = -H; x < W + H; x += sp0) { kk.moveTo(x, 0); kk.lineTo(x + H * 0.75 * u, H * 0.75 * u); }
  kk.stroke(); kk.restore();
  tn.fillStyle = T(BLK, 0.32 * u); tn.fill(HP);
  kk.lineWidth = 2.2; kk.strokeStyle = ink(BLK, u); kk.stroke(HP);
}
// a base: the U.S. white-star roundel. Press-black disc, the five-point star cut to bare paper (gold when it stands
// guard), a paper ring: frame 0 says "U.S. garrison" with no words
const STAR = (() => { const p = []; for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.382 : 1, a = -Math.PI / 2 + k * Math.PI / 5; p.push([r * Math.cos(a), r * Math.sin(a)]); } return p; })();
function starPath(c, x, y, r) { c.beginPath(); STAR.forEach(([u, v], i) => i ? c.lineTo(x + u * r, y + v * r) : c.moveTo(x + u * r, y + v * r)); c.closePath(); }
function basePin(x, y, s, goldA = 0, ringA = 1) {
  if (s <= 0.3) return;
  ko.beginPath(); ko.arc(x, y, s * 1.25 + 1.5, 0, TAU); ko.fill();
  kk.fillStyle = ink(BLK, ringA); kk.beginPath(); kk.arc(x, y, s, 0, TAU); kk.fill();
  if (s >= 3.2) {
    kk.save(); kk.globalCompositeOperation = 'destination-out'; kk.fillStyle = '#000'; starPath(kk, x, y, s * 0.78); kk.fill(); kk.restore();
    if (goldA > 0) { sp.fillStyle = ink(GOLD, goldA); starPath(sp, x, y, s * 0.78); sp.fill(); }
  } else if (goldA > 0) { sp.fillStyle = ink(GOLD, goldA); sp.beginPath(); sp.arc(x, y, s * 0.5, 0, TAU); sp.fill(); }
}
// a gold arc lifted off the globe along its great circle, cased in black
function arcOnGlobe(P, route, u0, u1, lift, w = 3, n = 22, draw = cased) {
  const [cx, cy] = P.translate(), r = P.scale(); const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = lerp(u0, u1, i / n), [lo, la] = route(u);
    if (!facing(P, lo, la)) { pts.push(null); continue; }
    const [x, y] = P([lo, la]), h = Math.sin(Math.PI * u) * Math.min(lift * r, 110);
    // small globes lift radially; deep zooms lift toward the top of the sheet (a radial lift would bend the route)
    let dx = x - cx, dy = y - cy, dn = Math.hypot(dx, dy) || 1; if (r > 1200) { dx = 0; dy = -1; dn = 1; }
    pts.push([x + dx / dn * h, y + dy / dn * h]);
  }
  draw(pts, w);
  return pts.filter(Boolean).at(-1);
}
function cased(pts, w, casing = 3.2) {
  strokeRun(kk, pts, w + casing, ink(BLK, 1)); kk.save(); kk.globalCompositeOperation = 'destination-out'; strokeRun(kk, pts, w + 0.4, '#000'); kk.restore();
  strokeRun(ko, pts, w + 1.2, PAPER); strokeRun(sp, pts, w, ink(GOLD, 1));
}
// a thread of Treasury paper (v9, Hudson's recycled dollars): a cased cream ribbon with its engraved rule and gold edges
function tbill(pts, w) {
  strokeRun(kk, pts, w + 3, ink(BLK, 1)); kk.save(); kk.globalCompositeOperation = 'destination-out'; strokeRun(kk, pts, w, '#000'); kk.restore();
  strokeRun(ko, pts, w + 1, PAPER); strokeRun(sp, pts, w, ink(GOLD, 0.55)); strokeRun(ko, pts, w - 2.4, PAPER);
  kk.setLineDash([2, 3]); strokeRun(kk, pts, 1, ink(BLK, 0.8)); kk.setLineDash([]);
}
function noteStack(x, y, s = 1) {   // a stack of T-bills at a money centre: engraved plates, a rosette, micro legend
  for (let k = 3; k >= 0; k--) { const ox = x - 44 * s + k * 5 * s, oy = y - 22 * s - k * 6 * s, w = 88 * s, h = 44 * s;
    ko.fillRect(ox - 2, oy - 2, w + 4, h + 4); kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 2; kk.strokeRect(ox, oy, w, h);
    if (k === 0) { kk.lineWidth = 0.8; kk.strokeRect(ox + 4 * s, oy + 4 * s, w - 8 * s, h - 8 * s); sp.strokeStyle = ink(GOLD, 1); sp.lineWidth = 1;
      for (let j = 0; j < 7; j++) { sp.beginPath(); for (let i = 0; i <= 60; i++) { const a = i / 60 * TAU, rr = (9 + 4 * Math.sin(a * 9 + j)) * s; i ? sp.lineTo(ox + w * 0.7 + Math.cos(a) * rr, oy + h / 2 + Math.sin(a) * rr) : sp.moveTo(ox + w * 0.7 + Math.cos(a) * rr, oy + h / 2 + Math.sin(a) * rr); } sp.stroke(); }
      kk.fillStyle = ink(BLK, 1); kk.font = `600 ${Math.round(10 * s)}px "Plex Mono"`; kk.textAlign = 'left'; kk.fillText('T-BILL', ox + 7 * s, oy + h / 2 + 4 * s); } }
}
function strokeRun(c, pts, w, col) {
  c.strokeStyle = col; c.lineWidth = w; c.beginPath(); let on = false;
  for (const q of pts) { if (!q) { on = false; continue; } on ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); on = true; }
  c.stroke();
}
// NATO compass seal on a pin: cracks in two and falls (picture only)
function seal(x, y, s, u) {
  if (u >= 1) return;
  for (const side of [-1, 1]) {
    for (const c of [ko, kk]) {
      c.save(); c.globalAlpha = 1 - clamp((u - 0.5) / 0.5);
      c.translate(x + side * u * s * 0.9, y + u * u * s * 2.2); c.rotate(side * u * 0.55);
      c.beginPath(); c.rect(side < 0 ? -s * 1.3 : 0, -s * 1.3, s * 1.3, s * 2.6); c.clip();
      if (c === ko) { c.beginPath(); c.arc(0, 0, s * 1.08, 0, TAU); c.fill(); }
      else {
        c.strokeStyle = ink(BLK, 1); c.fillStyle = ink(BLK, 1); c.lineWidth = s * 0.07;
        c.beginPath(); c.arc(0, 0, s, 0, TAU); c.stroke(); c.beginPath(); c.arc(0, 0, s * 0.72, 0, TAU); c.stroke();
        c.beginPath(); for (let k = 0; k < 8; k++) { const rr = k % 2 ? s * 0.16 : s * 0.66, a = k * Math.PI / 4 - Math.PI / 2; k ? c.lineTo(rr * Math.cos(a), rr * Math.sin(a)) : c.moveTo(rr * Math.cos(a), rr * Math.sin(a)); } c.closePath(); c.fill();
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; c.beginPath(); c.moveTo(0.74 * s * Math.cos(a), 0.74 * s * Math.sin(a)); c.lineTo(1.0 * s * Math.cos(a), 1.0 * s * Math.sin(a)); c.stroke(); }
      }
      c.restore();
    }
  }
  if (u > 0.02 && u < 0.4) { kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 3; kk.beginPath(); let yy = y - s * 1.1; kk.moveTo(x, yy); while (yy < y + s * 1.1) { yy += s * 0.2; kk.lineTo(x + (Math.sin(yy * 1.7) * s * 0.08), yy); } kk.stroke(); }
}
// the legend cartouche, printed on the sheet
// v8: one plain word at phone size (>= 48 px) and the count; the year when the frame is about time
// v9: an opaque card: the key and spot plates are cleared under it, so coasts and graticule never print through
function clearRect(x, y, w, h, cs = [kk, sp]) { for (const c of cs) { c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.fillRect(x, y, w, h); c.restore(); } }
function legend(beat, n, lines = null, goldZero = false, year = null) {
  const x = 60, y = 1290, w = year ? 560 : 400, h = 170;   // below the type band: the type owns 270-1250
  clearRect(x - 2, y - 2, w + 4, h + 4); ko.fillRect(x, y, w, h);
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 4; kk.strokeRect(x, y, w, h); kk.lineWidth = 1.5; kk.strokeRect(x + 8, y + 8, w - 16, h - 16);
  kk.fillStyle = ink(BLK, 1); kk.textAlign = 'left';
  const str = String(n);
  kk.font = '700 112px "Oswald"'; const nw = kk.measureText(str).width;
  if (goldZero && n === 0) { sp.fillStyle = ink(GOLD, 1); sp.font = '700 112px "Oswald"'; sp.fillText(str, x + 26, y + 138); kk.lineWidth = 3; kk.strokeText(str, x + 26, y + 138); }
  else kk.fillText(str, x + 26, y + 138);
  kk.font = '700 52px "Oswald"'; kk.fillText('BASES', x + 44 + nw, y + 80); kk.font = '700 40px "Oswald"'; kk.fillText('ABROAD', x + 44 + nw, y + 130);
  if (year) { kk.fillRect(x + w - 190, y + 24, 3, h - 48); kk.font = '700 84px "Oswald"'; kk.fillText(String(year), x + w - 168, y + 124); }
}

// ================================================================ 3D line work (construction scenes)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function cam3(eye, look, fov, cx = 540, cy = 960) {
  const f = nrm(sub(look, eye)), r = nrm(crs([0, 1, 0], f)), u = crs(f, r), F = (H / 2) / Math.tan(fov * Math.PI / 360);
  const P = q => { const d = sub(q, eye), z = dot(d, f); return [cx + dot(d, r) / z * F, cy - dot(d, u) / z * F, z]; };
  P.depth = q => dot(sub(q, eye), f); P.F = F; P.eye = eye;
  return P;
}
// a segment in 3D, near-clipped, drawn with a pen that thins and greys with distance (aerial perspective)
function seg3(c, P, a, b, w = 1, col = BLK, a0 = 1, near = 0.6) {
  let za = P.depth(a), zb = P.depth(b); if (za < near && zb < near) return;
  if (za < near) { const t = (near - za) / (zb - za); a = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; za = near; }
  if (zb < near) { const t = (near - zb) / (za - zb); b = [lerp(b[0], a[0], t), lerp(b[1], a[1], t), lerp(b[2], a[2], t)]; zb = near; }
  const A = P(a), Bq = P(b), z = (za + zb) / 2;
  c.strokeStyle = ink(col, a0 * clamp(1.25 - z / 1400, 0.25, 1)); c.lineWidth = clamp(w * P.F / z, 0.7, 14);
  c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(Bq[0], Bq[1]); c.stroke();
}
// v9: a long ground line in pieces, each with its own depth, so a rail keeps its weight near the lens (seg3 sizes a whole
// line by its mean depth, which turned the rails into hairlines)
function seg3n(c, P, a, b, w, col = BLK, a0 = 1, n = 28) {   // a line running along +z
  const ez = P.eye[2], zA = Math.max(a[2], ez + 0.7), zB = b[2]; if (zB <= zA) return;
  const dA = zA - ez, dB = zB - ez, at = z => { const q = (z - a[2]) / (b[2] - a[2]); return [lerp(a[0], b[0], q), lerp(a[1], b[1], q), z]; };
  for (let i = 0; i < n; i++) seg3(c, P, at(ez + dA * Math.pow(dB / dA, i / n)), at(ez + dA * Math.pow(dB / dA, (i + 1) / n)), w, col, a0);
}
function poly3(c, P, pts, fill) { c.beginPath(); pts.forEach((q, i) => { const [x, y] = P(q); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); c.fillStyle = fill; c.fill(); }
// lattice mast: legs from a square base to a waist; X-bracing on every face; returns the top centre
function lattice(c, P, base, hgt, w0, w1, lv, w = 0.18, col = BLK, a0 = 1) {
  const [bx, by, bz] = base, L = [];
  for (let i = 0; i <= lv; i++) { const t = i / lv, hw = lerp(w0, w1, Math.pow(t, 0.8)), y = by + hgt * t; L.push([[bx - hw, y, bz - hw], [bx + hw, y, bz - hw], [bx + hw, y, bz + hw], [bx - hw, y, bz + hw]]); }
  for (let i = 0; i < lv; i++) for (let j = 0; j < 4; j++) {
    const a = L[i][j], b = L[i][(j + 1) % 4], a2 = L[i + 1][j], b2 = L[i + 1][(j + 1) % 4];
    seg3(c, P, a, a2, w * 1.6, col, a0); seg3(c, P, a, b2, w, col, a0); seg3(c, P, b, a2, w, col, a0); if (i % 2 === 0) seg3(c, P, a, b, w, col, a0);
  }
  return [bx, by + hgt, bz];
}
function skyTone(top, mid, hy, sunX = 700, sunY = 0, sunA = 0) {
  const gr = tn.createLinearGradient(0, 0, 0, hy);
  gr.addColorStop(0, top); gr.addColorStop(0.6, mid); gr.addColorStop(1, T(GOLD, 0.25));
  tn.fillStyle = gr; tn.fillRect(0, 0, W, hy + 2);
  if (sunA) over(() => { const s = tn.createRadialGradient(sunX, sunY, 0, sunX, sunY, 420); s.addColorStop(0, T(PAPER, sunA)); s.addColorStop(0.35, T(PAPER, sunA * 0.4)); s.addColorStop(1, T(PAPER, 0)); tn.fillStyle = s; tn.fillRect(0, 0, W, hy + 2); });
}
// drifting halftone cloud masses (a depth plane that moves faster than the subject)
function clouds(seed, n, y0, y1, drift, col = BLK, a = 0.25, scale = 1) {
  const s = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = ((s() * 1600 + drift * (0.6 + s())) % 1600 + 1600) % 1600 - 260, y = lerp(y0, y1, s()), rw = (120 + s() * 260) * scale;
    for (let k = 0; k < 6; k++) {
      const gx = x + (s() - 0.5) * rw * 1.4, gy = y + (s() - 0.5) * rw * 0.35, gr = rw * (0.35 + s() * 0.4);
      const gg = tn.createRadialGradient(gx, gy, 0, gx, gy, gr); gg.addColorStop(0, T(col, a)); gg.addColorStop(1, T(col, 0));
      tn.fillStyle = gg; tn.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
  }
}
function hatchRect(c, x0, y0, x1, y1, ang, gap, w, col) {
  c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip(); c.strokeStyle = col; c.lineWidth = w; c.beginPath();
  const d = Math.hypot(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ca = Math.cos(ang), sa = Math.sin(ang);
  for (let s = -d; s < d; s += gap) { c.moveTo(cx + ca * -d - sa * s, cy + sa * -d + ca * s); c.lineTo(cx + ca * d - sa * s, cy + sa * d + ca * s); }
  c.stroke(); c.restore();
}
function hatchPath(c, path, ang, gap, w, col) {
  c.save(); c.clip(path); c.strokeStyle = col; c.lineWidth = w; c.beginPath(); const ca = Math.cos(ang), sa = Math.sin(ang), d = 2300;
  for (let s = -d; s < d; s += gap) { c.moveTo(540 - ca * d - sa * s, 960 - sa * d + ca * s); c.lineTo(540 + ca * d - sa * s, 960 + sa * d + ca * s); }
  c.stroke(); c.restore();
}
// ambient motes lit by the key (paper specks + gold)
function motes(seed, n, t, vx, vy, gold = 0.8) {
  const s = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = ((s() * W + t * vx * (0.5 + s())) % W + W) % W, y = ((s() * H + t * vy * (0.5 + s())) % H + H) % H, r = 1 + s() * 2.6;
    ko.beginPath(); ko.arc(x, y, r + 1, 0, TAU); ko.fill();
    if (s() < gold) { sp.fillStyle = ink(GOLD, 0.9); sp.beginPath(); sp.arc(x, y, r, 0, TAU); sp.fill(); }
  }
}

// ================================================================ people: silhouettes only (GRAPHICS_ROADMAP: no front-lit faces)
// Every figure is a solid key-plate shape against a lit ground, rim-lit in gold on the light's side: backs, profiles
// and crowd masses, never a face. rimmed(): black body, a gold rim stroked on paper where the light spills past it.
// (a shape is a Path2D or a list of them: each piece is filled on its own, so pieces never cut holes in each other)
function rimmed(path, dx = 3, dy = -2, rimW = 5, rimA = 1) {
  const ps = Array.isArray(path) ? path.flat(Infinity) : [path];
  if (rimA > 0) { ko.save(); ko.translate(dx, dy); ko.lineWidth = rimW + 2; for (const q of ps) ko.stroke(q); ko.restore();
    sp.save(); sp.translate(dx, dy); sp.strokeStyle = ink(GOLD, rimA); sp.lineWidth = rimW; for (const q of ps) sp.stroke(q); sp.restore();
    // the rim lives only outside the union of the pieces: cut it (and the paper under it) out of the body
    for (const c of [sp, ko]) { c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; for (const q of ps) c.fill(q); c.restore(); } }
  kk.fillStyle = ink(BLK, 1); for (const q of ps) kk.fill(q);
}
// a soldier from behind: M1 helmet, collar, shoulders, the pack, a slung rifle; feet at (x, y), height h, lean in rad
function soldierBack(x, y, h, o = {}) {
  const { pack = 1, rifle = 0, lean = 0, sway = 0, hat = 'm1', legs = 1 } = o, m = new DOMMatrix().translateSelf(x, y).rotateSelf(lean * 57.3).scaleSelf(h, h);
  const out = [], piece = f => { const q = new Path2D(); f(q); const p = new Path2D(); p.addPath(q, m); out.push(p); };
  const hx = sway * 0.01;
  // helmet (M1 from behind: a low dome with a flared rim) or the hard hat (taller, a full brim)
  // v8: the M1 from behind is a deep dome with a short, straight lip (no flare: a flared brim read as a bicorne)
  if (hat === 'm1') piece(q => { q.moveTo(hx - 0.084, -0.872); q.lineTo(hx - 0.079, -0.9); q.bezierCurveTo(hx - 0.079, -0.965, hx - 0.05, -1.0, hx, -1.0); q.bezierCurveTo(hx + 0.05, -1.0, hx + 0.079, -0.965, hx + 0.079, -0.9); q.lineTo(hx + 0.084, -0.872); q.closePath(); });
  else if (hat === 'hard') piece(q => { q.moveTo(hx - 0.12, -0.92); q.bezierCurveTo(hx - 0.09, -0.94, hx - 0.09, -1.02, hx, -1.02); q.bezierCurveTo(hx + 0.09, -1.02, hx + 0.09, -0.94, hx + 0.12, -0.92); q.closePath(); });
  piece(q => q.ellipse(hx * 0.8, -0.89, 0.058, 0.066, 0, 0, TAU));        // the back of the head
  piece(q => q.rect(-0.042, -0.87, 0.084, 0.07));                          // neck and collar
  piece(q => {   // shoulders, arms hanging, the jacket to the hips, then two legs (or cut at the waist behind a rail)
    q.moveTo(-0.05, -0.83); q.bezierCurveTo(-0.13, -0.83, -0.18, -0.81, -0.185, -0.76);
    q.lineTo(-0.2, -0.52); q.lineTo(-0.165, -0.49); q.lineTo(-0.14, -0.62); q.lineTo(-0.13, -0.47);
    if (legs) { q.lineTo(-0.115, -0.02); q.lineTo(-0.035, -0.0); q.lineTo(-0.01, -0.4); q.lineTo(0.01, -0.4); q.lineTo(0.035, 0); q.lineTo(0.115, -0.02); }
    else { q.lineTo(-0.13, -0.3); q.lineTo(0.13, -0.3); }
    q.lineTo(0.13, -0.47); q.lineTo(0.14, -0.62); q.lineTo(0.165, -0.49); q.lineTo(0.2, -0.52);
    q.lineTo(0.185, -0.76); q.bezierCurveTo(0.18, -0.81, 0.13, -0.83, 0.05, -0.83); q.closePath(); });
  if (pack) piece(q => { q.roundRect(-0.12, -0.81, 0.24, 0.26, 0.035); q.rect(-0.11, -0.575, 0.22, 0.06); });
  if (rifle) { piece(q => { q.moveTo(0.1, -0.8); q.lineTo(0.125, -0.81); q.lineTo(0.215, -1.13); q.lineTo(0.195, -1.135); q.closePath(); });
    piece(q => { q.moveTo(0.118, -0.6); q.lineTo(0.13, -0.6); q.lineTo(0.214, -1.06); q.lineTo(0.205, -1.062); q.closePath(); });   // the sling
    piece(q => { q.moveTo(0.1, -0.64); q.lineTo(0.14, -0.66); q.lineTo(0.16, -0.58); q.lineTo(0.12, -0.56); q.closePath(); }); }  // the butt at the hip
  return out;
}
// a worker at small scale, drawn from a pose: capsule limbs + head + hard hat (side-on or from behind; no face at this size)
// pose: joints in figure units (feet at 0, height 1), x to the right. tool: 'maul' | 'bar' | null
function workerPath(x, y, h, pose, dir = 1) {
  const out = [], J = (u, v) => [x + dir * u * h, y + v * h];
  const cap = (a, b, w) => { const [x1, y1] = J(...a), [x2, y2] = J(...b), dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, r = w * h / 2, nx = -dy / l * r, ny = dx / l * r;
    const q = new Path2D(); q.moveTo(x1 + nx, y1 + ny); q.lineTo(x2 + nx, y2 + ny); q.lineTo(x2 - nx, y2 - ny); q.lineTo(x1 - nx, y1 - ny); q.closePath(); out.push(q);
    for (const [cx, cy] of [[x1, y1], [x2, y2]]) { const c = new Path2D(); c.arc(cx, cy, r, 0, TAU); out.push(c); } };
  const { hip, neck, head, kneeL, footL, kneeR, footR, elbL, handL, elbR, handR, tool } = pose;
  cap(hip, neck, 0.25); cap([hip[0], hip[1] + 0.04], [neck[0], neck[1] + 0.1], 0.27); cap(hip, kneeL, 0.13); cap(kneeL, footL, 0.105); cap(hip, kneeR, 0.13); cap(kneeR, footR, 0.105);
  cap([neck[0], neck[1] + 0.03], elbL, 0.09); cap(elbL, handL, 0.075); cap([neck[0], neck[1] + 0.03], elbR, 0.09); cap(elbR, handR, 0.075);
  const p = new Path2D(); out.push(p);
  const [hx, hy] = J(...head); p.moveTo(hx + 0.065 * h, hy); p.arc(hx, hy, 0.065 * h, 0, TAU);
  const hat = new Path2D(); out.push(hat); hat.moveTo(hx - 0.1 * h, hy - 0.02 * h); hat.ellipse(hx, hy - 0.025 * h, 0.075 * h, 0.07 * h, 0, Math.PI, 0); hat.lineTo(hx + 0.1 * h, hy - 0.02 * h); hat.closePath();   // hard hat
  for (const [f, k] of [[footL, 1], [footR, 1]]) { const [fx, fy] = J(...f); { const f2 = new Path2D(); out.push(f2); f2.rect(fx - 0.02 * h, fy - 0.03 * h, dir * 0.11 * h, 0.035 * h); } }
  if (tool === 'maul') { const [a, b2] = [J(...handR), J(handR[0] + (handR[0] - elbR[0]) * 2.4, handR[1] + (handR[1] - elbR[1]) * 2.4)]; cap(handR, [handR[0] + (handR[0] - elbR[0]) * 2.4, handR[1] + (handR[1] - elbR[1]) * 2.4], 0.035);
    // the spike maul's head: long and narrow across the handle, one face blunt, the other tapering to the spike point
    const [mx, my] = b2, hx0 = b2[0] - a[0], hy0 = b2[1] - a[1], hl = Math.hypot(hx0, hy0) || 1, ux = hx0 / hl, uy = hy0 / hl, px = -uy, py = ux, L1 = 0.13 * h, L2 = 0.17 * h, th = 0.03 * h;
    const hd = new Path2D(); out.push(hd);
    hd.moveTo(mx - px * L1 - ux * th, my - py * L1 - uy * th); hd.lineTo(mx - px * L1 + ux * th, my - py * L1 + uy * th);
    hd.lineTo(mx + ux * th * 1.2, my + uy * th * 1.2); hd.lineTo(mx + px * L2 + ux * th * 0.25, my + py * L2 + uy * th * 0.25);
    hd.lineTo(mx + px * L2 - ux * th * 0.25, my + py * L2 - uy * th * 0.25); hd.lineTo(mx - ux * th * 1.2, my - uy * th * 1.2); hd.closePath(); }
  if (tool === 'bar') cap(handL, [handL[0] + 0.05, 0.02], 0.035);
  return out;
}
const POSES = {
  stand: { hip: [0, -0.5], neck: [0.01, -0.84], head: [0.03, -0.93], kneeL: [-0.03, -0.26], footL: [-0.06, 0], kneeR: [0.05, -0.26], footR: [0.07, 0], elbL: [-0.06, -0.66], handL: [-0.05, -0.5], elbR: [0.08, -0.66], handR: [0.1, -0.5] },
  swingUp: { hip: [0, -0.48], neck: [-0.04, -0.8], head: [-0.03, -0.9], kneeL: [0.08, -0.25], footL: [0.12, 0], kneeR: [-0.1, -0.24], footR: [-0.15, 0], elbL: [-0.12, -0.92], handL: [-0.1, -1.05], elbR: [-0.1, -0.95], handR: [-0.08, -1.06], tool: 'maul' },
  swingDown: { hip: [0, -0.44], neck: [0.12, -0.74], head: [0.19, -0.8], kneeL: [0.12, -0.24], footL: [0.14, 0], kneeR: [-0.1, -0.22], footR: [-0.16, 0], elbL: [0.24, -0.58], handL: [0.3, -0.44], elbR: [0.25, -0.6], handR: [0.32, -0.46], tool: 'maul' },
  pry: { hip: [0, -0.42], neck: [0.16, -0.7], head: [0.24, -0.76], kneeL: [0.14, -0.22], footL: [0.12, 0], kneeR: [-0.08, -0.24], footR: [-0.14, 0], elbL: [0.26, -0.5], handL: [0.3, -0.36], elbR: [0.24, -0.52], handR: [0.29, -0.4], tool: 'bar' },
  haul: { hip: [0, -0.46], neck: [-0.12, -0.78], head: [-0.16, -0.87], kneeL: [0.1, -0.24], footL: [0.2, 0], kneeR: [-0.06, -0.26], footR: [-0.1, 0], elbL: [-0.28, -0.72], handL: [-0.42, -0.74], elbR: [-0.26, -0.68], handR: [-0.4, -0.7] },
};
const mixPose = (a, b, u) => Object.fromEntries(Object.keys(a).map(k => [k, Array.isArray(a[k]) ? [lerp(a[k][0], b[k][0], u), lerp(a[k][1], b[k][1], u)] : a[k]]));
function hammerPose(t, ph) { const q = (t * 2 + ph) % 1, u = q < 0.55 ? ease.inOutCubic(q / 0.55) : 1 - ease.inCubic((q - 0.55) / 0.45); return mixPose(POSES.swingDown, POSES.swingUp, u); }
// a halftone crowd mass seen from behind (heads, hats and shoulders in rows), for crowd scale
function crowdMass(y0, y1, n, seed, t, o = {}) {
  const { hats = 0.5, lit = 1, bob = 0 } = o, r = rng(seed);
  for (let row = 0; row < n; row++) {
    const v = row / Math.max(1, n - 1), yy = lerp(y0, y1, v), s = lerp(0.8, 1.9, v), step = 58 * s, p = [];
    for (let x = -40 + r() * step; x < W + 40; x += step * (0.8 + r() * 0.45)) {
      const hy = yy - 70 * s + Math.sin(t * 5 + x * 0.05 + row) * bob * 6 * s, hw = 24 * s, q = new Path2D();
      q.moveTo(x - hw * 2.1, yy + 260 * s); q.lineTo(x - hw * 2.1, hy + 50 * s); q.bezierCurveTo(x - hw * 2.1, hy + 36 * s, x - hw * 1.3, hy + 30 * s, x, hy + 28 * s);
      q.bezierCurveTo(x + hw * 1.3, hy + 30 * s, x + hw * 2.1, hy + 36 * s, x + hw * 2.1, hy + 50 * s); q.lineTo(x + hw * 2.1, yy + 260 * s); q.closePath(); p.push(q);
      const hd = new Path2D(); hd.ellipse(x, hy, hw, hw * 1.15, 0, 0, TAU); p.push(hd);
      const k = r(), ht = new Path2D();
      if (k < hats * 0.6) { ht.ellipse(x, hy - hw * 0.3, hw * 1.45, hw * 0.24, 0, 0, TAU); p.push(ht);   // the hard hat: full brim, tall shell
        const cr = new Path2D(); cr.moveTo(x - hw * 1.05, hy - hw * 0.3); cr.bezierCurveTo(x - hw * 1.05, hy - hw * 1.6, x + hw * 1.05, hy - hw * 1.6, x + hw * 1.05, hy - hw * 0.3); cr.closePath(); p.push(cr); }
      else if (k < hats) { ht.moveTo(x - hw * 1.3, hy - hw * 0.4); ht.ellipse(x, hy - hw * 0.45, hw * 1.05, hw * 0.95, 0, Math.PI, 0); ht.lineTo(x + hw * 1.3, hy - hw * 0.4); ht.closePath(); p.push(ht); }
    }
    if (row < n - 1) {   // back rows: tone, lighter with distance, a paper haze behind the next row
      tn.fillStyle = T(BLK, lerp(0.55, 0.85, v)); for (const q of p) tn.fill(q);
      over(() => { const g = tn.createLinearGradient(0, yy - 40 * s, 0, yy + 60 * s); g.addColorStop(0, T(PAPER, 0)); g.addColorStop(1, T(PAPER, 0.5)); tn.fillStyle = g; tn.fillRect(0, yy - 40 * s, W, 100 * s); });
      sp.save(); sp.translate(0, -3); sp.strokeStyle = ink(GOLD, 0.7 * lit); sp.lineWidth = 3; for (const q of p) sp.stroke(q); sp.restore();
    } else rimmed(p, 0, -3, 4, lit);
  }
}

// ================================================================ shots
// 0-2 SHUT THE FUCK UP / ABOUT EUROPE.: Europe under the garrison ink (Capra's Why We Fight maps): every U.S. base
// is a white-star roundel, and black ink spreads out from each one from frame 0 (the thumbnail frame).
// 2-3.9 IT'S A MUSEUM.: a crash zoom on the b2 hit into the German cluster (Ramstein, Landstuhl, Baumholder...).
const RAMSTEIN = [7.6, 49.44];
function garrisonInk(P, b, x, k = 1) {   // one base's ink blot on the tone plate: grows with the square root of its age
  const age = b - x.born; if (age <= 0) return;
  const [px, py] = P([x.lo, x.la]), rr = k * (10 + 26 * Math.sqrt(Math.min(age, 6)));
  const g = tn.createRadialGradient(px, py, rr * 0.25, px, py, rr); g.addColorStop(0, T(BLK, 0.42)); g.addColorStop(0.7, T(BLK, 0.22)); g.addColorStop(1, T(BLK, 0));
  tn.fillStyle = g; tn.fillRect(px - rr, py - rr, rr * 2, rr * 2);
}
function shotEurope(b, t) {
  const hit = b >= 2 ? Math.exp(-(b - 2) * 6) : 0, zoom = ease.outExpo(clamp((b - 2) / 0.35));
  const punch = [0, 1].reduce((a, h) => a + (b >= h ? Math.exp(-(b - h) * 5) : 0), 0);
  const cut3 = b >= 3 ? 1.28 : 1;   // the second kick: punch in on the rope and the card
  const r = lerp(lerp(2100, 2350, b / 2), 8200 + (b - 2) * 900, zoom) * (1 + 0.08 * punch + 0.1 * hit) * cut3;
  const lo = lerp(lerp(14, 11, b / 2), RAMSTEIN[0] + 0.9, zoom), la = lerp(lerp(47, 48.5, b / 2), RAMSTEIN[1] - 0.2, zoom);
  // frame 0: the garrison below the hook (the block sits 270-830); v9: a 2 px/frame camera creep from frame 1
  const P = ortho(lo, la, r, 540 - 60 * Math.min(t, 1.2) * (1 - zoom), lerp(1300, 1080, zoom), lerp(-4 + b, 0, zoom));
  globe(P, { land: r > 3000 ? LANDC : LAND50, sea: 0.42, beat: b, borders: 1, grat: 0.7 });
  const EU0 = EUR.concat(flags.filter(f => f.reg === 'EU'));
  for (const x of EU0) if (facing(P, x.lo, x.la)) garrisonInk(P, b, x, lerp(1, 1.5, zoom));
  for (const x of EU0) {
    if (b < x.born || !facing(P, x.lo, x.la)) continue;
    const [px, py] = P([x.lo, x.la]), pop = ease.outBack(clamp((b - x.born) / 0.35));
    basePin(px, py, lerp(11, 17, zoom) * pop);
  }
  if (zoom > 0.5) {    // the in-world site names at the zoom, hand-set small (sub-legible texture, never a line)
    kk.fillStyle = ink(BLK, 1); kk.font = '600 17px "Plex Mono"'; kk.textAlign = 'left';
    for (const x of EU0) if (x.name && x.host === 'Germany' && facing(P, x.lo, x.la)) { const [px, py] = P([x.lo, x.la]); if (px > 40 && px < W - 200 && py > 200 && py < H - 200) { ko.fillRect(px + 20, py - 16, x.name.length * 10.5 + 8, 22); kk.fillText(x.name, px + 24, py); } }
  }
  if (zoom > 0.3) {   // the museum: a velvet rope on brass posts across the cluster, and the gallery card
    const a = clamp((zoom - 0.3) / 0.3), sag = 70, ry = 930, posts = [120, 540, 960], drop = (1 - ease.outBack(clamp((b - 2.15) / 0.3))) * -300;
    for (const px of posts) { const top = ry + drop - 20; ko.fillRect(px - 14, top - 26, 28, 450); sp.fillStyle = ink(GOLD, a); sp.fillRect(px - 8, top, 16, 420);
      sp.beginPath(); sp.arc(px, top - 4, 18, 0, TAU); sp.fill(); kk.strokeStyle = ink(BLK, a); kk.lineWidth = 3; kk.strokeRect(px - 8, top, 16, 420); kk.beginPath(); kk.arc(px, top - 4, 18, 0, TAU); kk.stroke(); }
    kk.strokeStyle = ink(BLK, a); kk.lineCap = 'round';
    for (let i = 0; i < 2; i++) { const x0 = posts[i], x1 = posts[i + 1]; kk.lineWidth = 22; kk.beginPath(); kk.moveTo(x0, ry + drop); kk.quadraticCurveTo((x0 + x1) / 2, ry + drop + sag * 2, x1, ry + drop); kk.stroke(); }
    // v9: the gallery card at phone size (cap >= 70 px), hung square in the picture under the rope
    const cx = 540, cy = 1270, cw = 800, ch = 250; ko.fillRect(cx - cw / 2, cy - ch / 2, cw, ch);
    kk.lineWidth = 5; kk.strokeRect(cx - cw / 2, cy - ch / 2, cw, ch); kk.lineWidth = 1.5; kk.strokeRect(cx - cw / 2 + 12, cy - ch / 2 + 12, cw - 24, ch - 24);
    kk.fillStyle = ink(BLK, a); kk.textAlign = 'center'; kk.font = '700 104px "Oswald"'; kk.fillText('EUROPE · 1945–', cx, cy + 22);
    kk.font = '700 46px "Oswald"'; kk.fillText('PERMANENT COLLECTION', cx, cy + 88);
  }
  motes(3, 26, t, 180, 20, 0.5);
  return { cell: 9, misreg: 1.6 + 3 * punch + 9 * hit, flash: b >= 2 && b < 2.07 ? 0.35 : 0 };
}
// soft paper-coloured cloud masses over the map, drawn as tone knock-backs (lighter plates)
function cloudKO(seed, n, drift, a = 1) {
  const s = rng(seed);
  over(() => { for (let i = 0; i < n; i++) {
    const x = ((s() * 1700 + drift * (0.7 + s() * 0.8)) % 1700 + 1700) % 1700 - 300, y = 250 + s() * 1500, rw = 160 + s() * 240;
    for (let k = 0; k < 7; k++) { const gx = x + (s() - 0.5) * rw * 1.6, gy = y + (s() - 0.5) * rw * 0.3, gr = rw * (0.3 + s() * 0.35);
      const gg = tn.createRadialGradient(gx, gy, 0, gx, gy, gr); gg.addColorStop(0, T(PAPER, 0.28 * a)); gg.addColorStop(1, T(PAPER, 0)); tn.fillStyle = gg; tn.fillRect(gx - gr, gy - gr, gr * 2, gr * 2); }
  } });
}
// US city lights on a globe or map
function lights(proj, test, beat, o = {}) {
  const { k = 1, glow = 0, max = 1400, minPop = 0, lit = null } = o;
  for (let i = 0; i < Math.min(max, CITY.length); i++) {
    const [, , la, lo, pop] = CITY[i]; if (pop < minPop || (test && !test(lo, la))) continue;
    if (lit && !lit(i)) continue;
    const [x, y] = proj([lo, la]); if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    const s = k * (0.9 + Math.log10(pop / 20000 + 1) * 1.6);
    ko.beginPath(); ko.arc(x, y, s + 1.2, 0, TAU); ko.fill();
    sp.fillStyle = ink(GOLD, 1); sp.beginPath(); sp.arc(x, y, s, 0, TAU); sp.fill();
    if (glow && pop > 250000) over(() => { const gg = tn.createRadialGradient(x, y, 0, x, y, s * 9 * glow); gg.addColorStop(0, T(GOLD, 0.85)); gg.addColorStop(1, T(GOLD, 0)); tn.fillStyle = gg; tn.fillRect(x - s * 9 * glow, y - s * 9 * glow, s * 18 * glow, s * 18 * glow); });
  }
}
// 3.9-8 TO BUILD / A CIVILIZATION.: the push-in from mid-Atlantic, where the cold open ends, onto the lit continent
function shotContinent(b, t) {
  const w = ease.inOutCubic(clamp((b - 3.9) / 0.5));   // the whip from the German cluster across the Atlantic
  const lo = lerp(RAMSTEIN[0], -97, w) + (b - 4) * 0.8, la = lerp(RAMSTEIN[1], 40, w), r = lerp(9000, 780, ease.outExpo(clamp((b - 3.9) / 0.6))) + (b - 4) * 18;
  const P = ortho(lo, la, r, 540, 1000, lerp(0, -8, w) + (b - 4) * 1.5);
  globe(P, { land: r > 1500 ? LAND50 : LAND110, sea: 0.66, beat: b, grat: 0.75 });
  const civ = clamp((b - 6) / 0.4);
  lights(P, (lo2, la2) => facing(P, lo2, la2), b, { k: lerp(0.75, 1.15, civ), glow: 0.35 * civ, minPop: lerp(60000, 0, clamp((b - 4.2) / 2.5)) });
  // night: the terminator crosses the Atlantic side
  const [cx, cy] = P.translate();
  const tg = tn.createLinearGradient(cx + r * 0.2, 0, cx + r, 0); tg.addColorStop(0, T(BLK, 0)); tg.addColorStop(1, T(BLK, 0.45));
  tn.fillStyle = tg; tn.beginPath(); tn.arc(cx, cy, r, 0, TAU); tn.fill();
  return { cell: 9, misreg: b < 4.4 ? 6 : 1.6, smear: b > 3.9 && b < 4.5 ? (1 - Math.abs(b - 4.15) / 0.3) : 0 };
}
// 8-12 750 BASES. (every base on the hit; the counter reads 750) / EIGHTY COUNTRIES. (the hosts hatch)
const CUTS = [[70, -30], [10, 20], [-20, 95], [40, 150], [80, 60], [-60, -100], [25, -60]].map(([la, lo]) => {
  const p = [Math.cos(la * D2R) * Math.cos(lo * D2R), Math.cos(la * D2R) * Math.sin(lo * D2R), Math.sin(la * D2R)];
  const n = Math.hypot(p[1], p[0]) || 1, e1 = [p[1] / n, -p[0] / n, 0];
  return [e1, crs(p, e1)];
});
// 12-16 EIGHTY YEARS.: the same globe keeps turning while the garrison ink ages and spreads (1945 -> 2026 on the
// card); on the second kick (b14) the camera punches in on Europe, the ink at its oldest and blackest.
// 8-16 (v9, Neurath/Arntz Isotype + Capra's ink): the count IS the picture. 750 white-star roundels stamp onto the
// globe in batches, one batch on every 16th from b8 to b11.75 (the song's stamp clacks), country by country west to
// east; each host floods with hard black ink on its first stamp (the eighty countries, no caption). The counter card
// swings up at plant scale on the b8 hit (it is the frame's line, 750 BASES ABROAD) and runs with the stamps, then
// shrinks to the corner. b10 punches in; b12 EIGHTY YEARS. slams while the year card runs 1945 -> 2026 at 120 px.
const STAMP0 = 8, TICKS = 16;
{ const hostLo = {}; for (const h of HOST80) { const f = byName[h]; hostLo[h] = f ? geoCentroid(f)[0] : 0; }
  const order = bases.slice().sort((a, b2) => (hostLo[a.host] - hostLo[b2.host]) || (a.lo - b2.lo));
  order.forEach((x, i) => { x.stamp = STAMP0 + Math.floor(i * TICKS / order.length) * 0.25; });
}
const FLOOD = {}; for (const x of bases) FLOOD[x.host] = Math.min(FLOOD[x.host] ?? 99, x.stamp);
const stampedBy = b => bases.filter(x => x.stamp <= b + 1e-6).length;
function card(b, n, { s = 1, cx = 260, cy = 1375, rot = 0, year = null } = {}) {   // the legend cartouche, scaled about its centre
  for (const c of [ko, kk, sp]) { c.save(); c.translate(cx, cy); c.rotate(rot); c.scale(s, s); c.translate(-260, -1375); }
  legend(b, n, null, false, year);
  for (const c of [ko, kk, sp]) c.restore();
}
function yearCard(b, yr) {   // the year at 120 px cap, in its own frame under the globe
  const cx = 540, cy = 1560, w = 560, h = 230;
  clearRect(cx - w / 2 - 2, cy - h / 2 - 2, w + 4, h + 4); ko.fillRect(cx - w / 2, cy - h / 2, w, h); kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 5; kk.strokeRect(cx - w / 2, cy - h / 2, w, h); kk.lineWidth = 1.5; kk.strokeRect(cx - w / 2 + 12, cy - h / 2 + 12, w - 24, h - 24);
  kk.fillStyle = ink(BLK, 1); kk.textAlign = 'center'; kk.font = '700 176px "Oswald"'; kk.fillText(String(yr), cx, cy + 64);
}
function shotWorld(b, t) {
  const sweep = ease.inOutCubic(clamp((b - 8) / 4.5)), yrs = ease.inOutCubic(clamp((b - 12.1) / 2.2));
  const punch = ease.outExpo(clamp((b - 14) / 0.25)), p10 = b >= 10 ? ease.outExpo(clamp((b - 10) / 0.2)) * (1 - ease.inOutCubic(clamp((b - 11.8) / 0.2))) : 0;
  const lo = lerp(lerp(-45, 58, sweep) + Math.max(0, b - 12.5) * 3, 14 + (b - 14) * 1.5, punch), la = lerp(lerp(30, 28, sweep), 47, punch);
  const r = lerp(560, 1500 + (b - 14) * 120, punch) * (1 + 0.45 * p10) * (1 + 0.06 * Math.exp(-Math.max(0, b - 8) * 5)) * (1 + 0.06 * (b >= 12 ? Math.exp(-(b - 12) * 5) : 0));
  const P = ortho(lo, la, r, 540, lerp(lerp(900, 1000, p10), 900, punch), 0);
  globe(P, { land: r > 1200 ? LAND50 : LAND110, sea: 0.5, beat: b, grat: 0.8, wl: 0.8, borders: punch });
  // Capra: each host floods with hard ink on its first stamp (a 2-frame spread from its edge, then solid)
  const kk0 = [];
  for (const h of HOST80) { const ft = FLOOD[h]; if (ft === undefined || b < ft || !byName[h]) continue;
    const HP = P2(P, byName[h]), u = clamp((b - ft) / 0.08); tn.fillStyle = T(BLK, 0.55 * u + 0.1 * yrs); tn.fill(HP); kk0.push(HP); }
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 2.2; for (const q of kk0) kk.stroke(q);
  // the ink ages: every base's blot grows with the years
  if (yrs > 0) for (const x of bases) if (facing(P, x.lo, x.la)) { const [px, py] = P([x.lo, x.la]), rr = (12 + 40 * yrs) * (r / 560) ** 0.5;
    const g = tn.createRadialGradient(px, py, rr * 0.2, px, py, rr); g.addColorStop(0, T(BLK, 0.3 + 0.2 * yrs)); g.addColorStop(1, T(BLK, 0)); tn.fillStyle = g; tn.fillRect(px - rr, py - rr, rr * 2, rr * 2); }
  const pin = lerp(lerp(7, 10, p10), 11, punch);
  for (const x of bases) {
    if (b < x.stamp || !facing(P, x.lo, x.la)) continue;
    const a = (b - x.stamp) * B.spb, k = a < 0.034 ? 2.1 : a < 0.067 ? 1.45 : 1;   // the stamp: big on its frame, seated two frames on
    const [px, py] = P([x.lo, x.la]); basePin(px, py, pin * k);
    if (a < 0.1) { kk.strokeStyle = ink(BLK, 1 - a * 10); kk.lineWidth = 2; kk.beginPath(); kk.arc(px, py, pin * (2 + a * 30), 0, TAU); kk.stroke(); }
  }
  const n = stampedBy(b), sw = ease.outBack(clamp((b - 8) / 0.3)), home = ease.inOutCubic(clamp((b - 9.2) / 0.5));
  if (b < 12) card(b, n, { s: lerp(lerp(1.2, 2.1, sw), 0.72, home), cx: lerp(540, 205, home), cy: lerp(560, 1420, home), rot: lerp(-0.25 * (1 - sw), 0, home) });
  else { card(b, 750, { s: 0.72, cx: 205, cy: lerp(1420, 1300, ease.outCubic(clamp((b - 12) / 0.3))) }); yearCard(b, Math.round(lerp(1945, 2026, yrs))); }
  return { cell: 9, misreg: 1.6 + 6 * Math.exp(-(b - 8) * 6) + 4 * (b >= 10 ? Math.exp(-(b - 10) * 6) : 0) + 4 * (b >= 12 ? Math.exp(-(b - 12) * 6) : 0) + 6 * (b >= 14 ? Math.exp(-(b - 14) * 6) : 0) };
}
// 12-16 ALL GUARD DUTY.: the scale jump to one base at ground level, at night. A sentry, backlit by the gate's
// floodlight, stands his watch at the wire; beyond it the old town (spires, a dome, the clock tower) sleeps: the museum.
const TOWN = (() => { const r = rng(1648), out = []; let x = -40;
  while (x < W + 60) { const k = r(); let w = 30 + r() * 60, h = 40 + r() * 70, kind = 'roof';
    if (k < 0.07) { kind = 'spire'; w = 46; h = 260 + r() * 90; } else if (k < 0.12) { kind = 'dome'; w = 120; h = 150; } else if (k < 0.17) { kind = 'tower'; w = 44; h = 190; }
    out.push({ x, w, h, kind, win: r() }); x += w + r() * 6; } return out; })();
// a columned temple front (the museum at b4, the exchange at b28: they are guarding two temples). Steps, columns
// with fluting, the entablature and its frieze, the pediment. tone(): the fill in the tone plate. -> the frieze box
function templeFront(cx, by, w, h, { tone = T(PAPER, 0.6), keyA = 1, cols = 8, lw = 3, ent = 0.14 } = {}) {
  const stepH = h * 0.1, colH = h * (0.69 - ent), entH = h * ent, pedH = h * 0.21, x0 = cx - w / 2, colW = w / (cols * 1.9);
  const shape = new Path2D();
  for (let k = 0; k < 3; k++) shape.rect(x0 - (2 - k) * w * 0.02, by - (k + 1) * stepH / 3, w + (2 - k) * w * 0.04, stepH / 3 + 1);
  const cy1 = by - stepH, cy0 = cy1 - colH, xs = [];
  for (let i = 0; i < cols; i++) { const x = x0 + w * 0.05 + (i + 0.5) * (w * 0.9) / cols; xs.push(x); shape.rect(x - colW / 2, cy0, colW, colH); }
  const ey = cy0 - entH; shape.rect(x0 - w * 0.02, ey, w * 1.04, entH);
  shape.moveTo(x0 - w * 0.03, ey); shape.lineTo(cx, ey - pedH); shape.lineTo(x0 + w * 1.03, ey); shape.closePath();
  over(() => { tn.fillStyle = tone; tn.fill(shape); });
  kk.strokeStyle = ink(BLK, keyA); kk.lineWidth = lw; kk.stroke(shape);
  kk.lineWidth = Math.max(1, lw * 0.4);
  for (const x of xs) for (const f of [-0.25, 0, 0.25]) { kk.beginPath(); kk.moveTo(x + f * colW, cy0 + 6); kk.lineTo(x + f * colW, cy1 - 6); kk.stroke(); }
  // the shadowed colonnade: tone between the columns
  tn.fillStyle = T(BLK, 0.55); for (let i = 0; i < cols - 1; i++) tn.fillRect(xs[i] + colW / 2, cy0, xs[i + 1] - xs[i] - colW, colH);
  kk.beginPath(); kk.moveTo(x0 - w * 0.02, ey + entH * 0.35); kk.lineTo(x0 + w * 1.02, ey + entH * 0.35); kk.stroke();
  return { x1: x0, x2: x0 + w, y1: ey + entH * 0.35, y2: cy0, apex: [cx, ey - pedH] };
}
function shotSentry(b, t) {
  const age = b - 4, kick2 = b >= 6 ? ease.outExpo(clamp((b - 6) / 0.2)) : 0;
  const z = 1 + 0.12 * Math.exp(-age * 7) + age * 0.018 + 0.22 * kick2, hy = 1180;
  const X = x => 540 + (x - 540) * z, Y = y => hy + (y - hy) * z;
  // night sky over the old continent, a grey stone glow at the horizon
  const gr = tn.createLinearGradient(0, 0, 0, hy); gr.addColorStop(0, T(BLK, 0.92)); gr.addColorStop(0.7, T(BLK, 0.72)); gr.addColorStop(1, T(BLK, 0.45));
  tn.fillStyle = gr; tn.fillRect(0, 0, W, hy);
  // the museum beyond the wire: cathedral spires either side, the columned front floodlit in paper tone
  for (const [sx, sw, sh] of [[70, 150, 820], [1010, 150, 760], [230, 90, 560], [850, 90, 520]]) {
    const sp2 = new Path2D(), x0 = X(sx - sw / 2), x1 = X(sx + sw / 2), mid = X(sx);
    sp2.moveTo(x0, Y(hy)); sp2.lineTo(x0, Y(hy - sh * 0.45)); sp2.lineTo(mid, Y(hy - sh)); sp2.lineTo(x1, Y(hy - sh * 0.45)); sp2.lineTo(x1, Y(hy)); sp2.closePath();
    over(() => { tn.fillStyle = T(PAPER, 0.35); tn.fill(sp2); }); tn.fillStyle = T(BLK, 0.35); tn.fill(sp2); kk.strokeStyle = ink(BLK, 0.9); kk.lineWidth = 2; kk.stroke(sp2);
    kk.lineWidth = 1.2; for (let k = 1; k < 5; k++) { const yy = Y(hy - sh * 0.45 * k / 5); kk.beginPath(); kk.moveTo(x0, yy); kk.lineTo(x1, yy); kk.stroke(); }
  }
  templeFront(X(540), Y(hy + 10), 760 * z, 470 * z, { tone: T(PAPER, 0.62), keyA: 0.95, cols: 8, lw: 2.5 });
  // the ground: tarmac to the gate, the white stop line
  const gg = tn.createLinearGradient(0, hy, 0, H); gg.addColorStop(0, T(BLK, 0.8)); gg.addColorStop(1, T(BLK, 0.95)); tn.fillStyle = gg; tn.fillRect(0, hy, W, H - hy);
  // the floodlight behind the sentry: a paper bloom and its cone on the ground
  const fx = X(700), fy = Y(760);
  over(() => { const g = tn.createRadialGradient(fx, fy, 0, fx, fy, 900 * z); g.addColorStop(0, T(PAPER, 1)); g.addColorStop(0.12, T(PAPER, 0.85)); g.addColorStop(0.45, T(GOLD, 0.35)); g.addColorStop(1, T(GOLD, 0)); tn.fillStyle = g; tn.fillRect(0, 0, W, H); });
  over(() => { const cone = new Path2D(); cone.moveTo(fx, fy); cone.lineTo(X(-200), H); cone.lineTo(X(1400), H); cone.closePath(); const g = tn.createLinearGradient(0, fy, 0, H); g.addColorStop(0, T(PAPER, 0.5)); g.addColorStop(1, T(PAPER, 0.05)); tn.fillStyle = g; tn.fill(cone); });
  kk.lineWidth = 6 * z; kk.strokeStyle = ink(BLK, 1); kk.beginPath(); kk.moveTo(fx + 20 * z, fy); kk.lineTo(fx + 30 * z, Y(hy + 260)); kk.stroke();
  kk.fillStyle = ink(BLK, 1); kk.fillRect(fx - 40 * z, fy - 26 * z, 80 * z, 30 * z);
  // the fence: posts, chain link (a diamond hatch), three strands of wire and the barbed coil on top; the gate open
  const fTop = Y(hy - 330), fBot = Y(hy + 150), gate0 = X(380), gate1 = X(720);
  kk.save(); kk.beginPath(); kk.rect(0, fTop, gate0, fBot - fTop); kk.rect(gate1, fTop, W - gate1, fBot - fTop); kk.clip();
  kk.strokeStyle = ink(BLK, 0.8); kk.lineWidth = 1.3; kk.beginPath(); const gap = 26 * z;
  for (let x = -H; x < W + H; x += gap) { kk.moveTo(x, fTop); kk.lineTo(x + (fBot - fTop), fBot); kk.moveTo(x, fBot); kk.lineTo(x + (fBot - fTop), fTop); } kk.stroke(); kk.restore();
  kk.lineWidth = 7 * z; for (const x of [0, 190, gate0 / z * 0 + 380, 720, 900, 1080]) { kk.beginPath(); kk.moveTo(X(x), fBot); kk.lineTo(X(x), fTop - 30 * z); kk.lineTo(X(x) + 26 * z, fTop - 60 * z); kk.stroke(); }
  kk.lineWidth = 2; for (let k = 0; k < 3; k++) { const y = fTop - 30 * z - k * 12 * z; kk.beginPath(); kk.moveTo(0, y + k * 10); kk.lineTo(W, y + k * 10); kk.stroke(); }
  kk.lineWidth = 1.6; kk.beginPath(); for (let x = -20; x < W + 20; x += 7) { const a = x * 0.18; kk.lineTo(x + 12 * Math.cos(a) * z, fTop - 50 * z + 12 * Math.sin(a) * z); } kk.stroke();
  // the gate's sign: the white-star roundel
  basePin(X(250), Y(hy - 120), 58 * z, 0);
  // the guard booth by the gate, its window lit
  const bx = X(760), by = Y(hy + 40); tn.fillStyle = T(BLK, 0.85); tn.fillRect(bx, by - 260 * z, 170 * z, 260 * z); kk.lineWidth = 3; kk.strokeRect(bx, by - 260 * z, 170 * z, 260 * z);
  ko.fillRect(bx + 22 * z, by - 210 * z, 120 * z, 80 * z); sp.fillStyle = ink(GOLD, 1); sp.fillRect(bx + 22 * z, by - 210 * z, 120 * z, 80 * z);
  kk.fillStyle = ink(BLK, 1); kk.fillRect(bx - 12 * z, by - 280 * z, 194 * z, 26 * z);
  // the sentry: a back to us, rifle slung, at the stop line in the open gate; his long shadow runs to the lens
  const sx = X(540), sy = Y(hy + 330), sh = 560 * z, br = Math.sin(t * 1.3) * 0.004;
  const shadow = new Path2D(); shadow.moveTo(sx - 50 * z, sy); shadow.lineTo(sx + 50 * z, sy); shadow.lineTo(sx - 150 * z, H + 50); shadow.lineTo(sx - 520 * z, H + 50); shadow.closePath();
  tn.fillStyle = T(BLK, 0.7); tn.fill(shadow);
  rimmed(soldierBack(sx, sy, sh, { rifle: 1, lean: br, pack: 0 }), 4, -4, 7, 1);
  motes(12, 55, t, 12, -30, 0.9);
  return { cell: 9, misreg: 1.6 + 7 * Math.exp(-age * 7) + (b >= 6 ? 6 * Math.exp(-(b - 6) * 7) : 0) };
}
// 4-8 WE'RE THE GUARDS. (v9, Struth's Museum Photographs): a gallery room of old Europe, gilt frames under brass
// picture lights on an oxblood wall (a cathedral, a crowned portrait, a ruin). The U.S. soldier stands at the velvet
// rope with his back to us, hands clasped at the small of his back like the room's attendant, rifle slung; he is lit
// only by the picture lights (a gold rim from above), never from the front. The words go at b5.5; the shot pushes in.
function guardBack(x, y, h, sway = 0) {   // a soldier at parade rest from behind: feet at (x, y), height h
  const m = new DOMMatrix().translateSelf(x, y).rotateSelf(sway * 57.3).scaleSelf(h, h), out = [];
  const piece = f => { const q = new Path2D(); f(q); const p = new Path2D(); p.addPath(q, m); out.push(p); };
  piece(q => {   // the M1 from behind: a deep dome, a short straight lip
    q.moveTo(-0.084, -0.902); q.bezierCurveTo(-0.088, -0.962, -0.052, -1.0, 0, -1.0); q.bezierCurveTo(0.052, -1.0, 0.088, -0.962, 0.084, -0.902);
    q.lineTo(0.09, -0.897); q.lineTo(0.088, -0.889); q.lineTo(-0.088, -0.889); q.lineTo(-0.09, -0.897); q.closePath(); });
  piece(q => q.rect(-0.036, -0.895, 0.072, 0.05));                                        // the neck under the lip
  piece(q => {   // jacket, the arms folded back at parade rest (elbows out, hands at the small of the back), the legs
    q.moveTo(-0.05, -0.862); q.quadraticCurveTo(-0.1, -0.858, -0.132, -0.836);
    q.bezierCurveTo(-0.16, -0.826, -0.174, -0.795, -0.173, -0.762);
    q.lineTo(-0.184, -0.662); q.bezierCurveTo(-0.188, -0.636, -0.176, -0.616, -0.156, -0.613);
    q.lineTo(-0.113, -0.592); q.lineTo(-0.118, -0.505); q.lineTo(-0.121, -0.462);
    q.lineTo(-0.112, -0.455); q.lineTo(-0.1, -0.27); q.lineTo(-0.088, -0.078); q.quadraticCurveTo(-0.1, -0.066, -0.094, -0.048);
    q.lineTo(-0.092, -0.006); q.lineTo(-0.086, 0); q.lineTo(-0.026, 0); q.lineTo(-0.028, -0.05); q.quadraticCurveTo(-0.022, -0.068, -0.03, -0.08);
    q.lineTo(-0.012, -0.43); q.lineTo(0.012, -0.43);
    q.lineTo(0.03, -0.08); q.quadraticCurveTo(0.022, -0.068, 0.028, -0.05); q.lineTo(0.026, 0); q.lineTo(0.086, 0); q.lineTo(0.092, -0.006);
    q.lineTo(0.094, -0.048); q.quadraticCurveTo(0.1, -0.066, 0.088, -0.078); q.lineTo(0.1, -0.27); q.lineTo(0.112, -0.455);
    q.lineTo(0.121, -0.462); q.lineTo(0.118, -0.505); q.lineTo(0.113, -0.592); q.lineTo(0.156, -0.613);
    q.bezierCurveTo(0.176, -0.616, 0.188, -0.636, 0.184, -0.662); q.lineTo(0.173, -0.762);
    q.bezierCurveTo(0.174, -0.795, 0.16, -0.826, 0.132, -0.836); q.quadraticCurveTo(0.1, -0.858, 0.05, -0.862); q.closePath(); });
  piece(q => {   // the rifle on its sling behind the right shoulder, muzzle up: barrel, front sight, handguard, stock
    q.moveTo(0.104, -1.105); q.lineTo(0.112, -1.105); q.lineTo(0.113, -1.09); q.lineTo(0.118, -1.089); q.lineTo(0.12, -0.86);
    q.lineTo(0.128, -0.855); q.lineTo(0.136, -0.72); q.lineTo(0.15, -0.7); q.lineTo(0.152, -0.64); q.lineTo(0.166, -0.52);
    q.lineTo(0.146, -0.506); q.lineTo(0.124, -0.52); q.lineTo(0.118, -0.64); q.lineTo(0.112, -0.72); q.lineTo(0.106, -0.86); q.closePath(); });
  piece(q => { q.moveTo(0.105, -1.06); q.lineTo(0.098, -1.06); q.lineTo(0.064, -0.84); q.lineTo(0.072, -0.838); q.closePath(); });   // the sling over the shoulder
  return out;
}
function gilt(x, y, w, h, th, z = 1) {   // a gilt frame: gold moulding with its bevels cut in the key, corner cartouches
  const o = new Path2D(); o.rect(x, y, w, h); o.rect(x + th, y + th, w - 2 * th, h - 2 * th);
  ko.save(); ko.fill(o, 'evenodd'); ko.restore();
  sp.save(); sp.fillStyle = ink(GOLD, 1); sp.fill(o, 'evenodd'); sp.restore();
  tn.save(); tn.fillStyle = T(BLK, 0.22); tn.beginPath(); tn.rect(x + w - th, y, th, h); tn.rect(x, y + h - th, w, th); tn.fill(); tn.restore();   // the lower right in shade
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 2.5 * z; kk.strokeRect(x, y, w, h); kk.strokeRect(x + th, y + th, w - 2 * th, h - 2 * th);
  kk.lineWidth = 1.2 * z; for (const f of [0.3, 0.55, 0.78]) kk.strokeRect(x + th * f, y + th * f, w - 2 * th * f, h - 2 * th * f);
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { const px = cx + (cx === x ? th / 2 : -th / 2), py = cy + (cy === y ? th / 2 : -th / 2);
    kk.beginPath(); kk.arc(px, py, th * 0.42, 0, TAU); kk.stroke(); kk.beginPath(); kk.arc(px, py, th * 0.18, 0, TAU); kk.fill(); }
  kk.lineWidth = 1; kk.beginPath(); for (let s0 = x + th; s0 < x + w - th; s0 += 9 * z) { kk.moveTo(s0, y + th * 0.3); kk.lineTo(s0 + 4 * z, y + th * 0.55); kk.moveTo(s0, y + h - th * 0.3); kk.lineTo(s0 + 4 * z, y + h - th * 0.55); } kk.stroke();
}
function pictureLight(cx, y, w, z = 1) {   // a brass picture light and the pool it throws down the canvas
  over(() => { const g = tn.createRadialGradient(cx, y + 40 * z, 10, cx, y + 170 * z, 520 * z); g.addColorStop(0, T(PAPER, 0.7)); g.addColorStop(0.3, T(PAPER, 0.28)); g.addColorStop(1, T(PAPER, 0));
    tn.fillStyle = g; tn.beginPath(); tn.moveTo(cx - w * 0.45, y); tn.lineTo(cx + w * 0.45, y); tn.lineTo(cx + w * 1.2, y + 700 * z); tn.lineTo(cx - w * 1.2, y + 700 * z); tn.closePath(); tn.fill(); });
  ko.fillRect(cx - w / 2 - 3, y - 14 * z, w + 6, 20 * z); sp.fillStyle = ink(GOLD, 1); sp.fillRect(cx - w / 2, y - 12 * z, w, 16 * z);
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 2; kk.strokeRect(cx - w / 2, y - 12 * z, w, 16 * z); kk.fillStyle = ink(BLK, 1); kk.fillRect(cx - w / 2, y + 1 * z, w, 3 * z);
  kk.lineWidth = 4 * z; kk.beginPath(); kk.moveTo(cx, y - 12 * z); kk.lineTo(cx, y - 44 * z); kk.stroke();
}
function shotGallery(b, t) {
  const age = b - 4, kick = b >= 6 ? ease.outExpo(clamp((b - 6) / 0.22)) : 0;
  const z = (1 + 0.1 * Math.exp(-age * 7)) * (1 + 0.03 * age + 0.16 * kick), fx0 = 560, fy0 = 1020;
  const X = x => fx0 + (x - fx0) * z, Y = y => fy0 + (y - fy0) * z, S = v => v * z;
  // the wall: oxblood, a faint damask of vertical lines; the dado rail; the parquet floor running to the vanishing point
  tn.fillStyle = T(RED, 0.7); tn.fillRect(0, 0, W, H); tn.fillStyle = T(BLK, 0.62); tn.fillRect(0, 0, W, H);
  kk.strokeStyle = ink(BLK, 0.18); kk.lineWidth = 1.2; kk.beginPath(); for (let x = -400; x < 1500; x += 26) { kk.moveTo(X(x), 0); kk.lineTo(X(x), Y(1330)); } kk.stroke();
  const fl = Y(1560);
  tn.fillStyle = T(BLK, 0.55); tn.fillRect(0, Y(1330), W, fl - Y(1330));
  kk.lineWidth = 3; kk.strokeStyle = ink(BLK, 1); kk.beginPath(); kk.moveTo(0, Y(1330)); kk.lineTo(W, Y(1330)); kk.moveTo(0, Y(1352)); kk.lineTo(W, Y(1352)); kk.stroke();
  sp.strokeStyle = ink(GOLD, 0.9); sp.lineWidth = 2; sp.beginPath(); sp.moveTo(0, Y(1341)); sp.lineTo(W, Y(1341)); sp.stroke();
  kk.lineWidth = 1.5; for (let x = -300; x < 1500; x += 300) kk.strokeRect(X(x + 30), Y(1390), S(240), S(130));
  tn.fillStyle = T(GOLD, 0.7); tn.fillRect(0, fl, W, H - fl); tn.fillStyle = T(BLK, 0.42); tn.fillRect(0, fl, W, H - fl);
  kk.lineWidth = 1.3; kk.strokeStyle = ink(BLK, 0.7); kk.beginPath();
  for (let k = -30; k <= 30; k++) { kk.moveTo(X(fx0 + k * 60), fl); kk.lineTo(X(fx0 + k * 60 * 5.5), H + 20); }
  for (let yy = 0; yy < 12; yy++) { const v = fl + (H - fl) * Math.pow(yy / 11, 1.7); kk.moveTo(0, v); kk.lineTo(W, v); } kk.stroke();
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 3; kk.beginPath(); kk.moveTo(0, fl); kk.lineTo(W, fl); kk.stroke();
  // the paintings: a cathedral front (centre), a crowned portrait (left, cropped), a ruin at sunset (right, cropped)
  const C = { x: X(262), y: Y(430), w: S(596), h: S(740), th: S(48) };
  { const cx0 = C.x + C.th, cy0 = C.y + C.th, cw = C.w - 2 * C.th, chh = C.h - 2 * C.th, U = (u, v) => [cx0 + u * cw, cy0 + v * chh];
    const sky = tn.createLinearGradient(0, cy0, 0, cy0 + chh); sky.addColorStop(0, T(BLK, 0.75)); sky.addColorStop(0.55, T(GOLD, 0.8)); sky.addColorStop(1, T(BLK, 0.6));
    tn.fillStyle = sky; tn.fillRect(cx0, cy0, cw, chh);
    const fa = new Path2D(), pt = (u, v) => U(u, v);
    const poly = pts => { pts.forEach(([u, v], i) => { const [px, py] = pt(u, v); i ? fa.lineTo(px, py) : fa.moveTo(px, py); }); fa.closePath(); };
    poly([[0.16, 1], [0.16, 0.34], [0.2, 0.3], [0.24, 0.07], [0.28, 0.3], [0.32, 0.34], [0.32, 0.45], [0.5, 0.3], [0.68, 0.45], [0.68, 0.34], [0.72, 0.3], [0.76, 0.07], [0.8, 0.3], [0.84, 0.34], [0.84, 1]]);
    tn.fillStyle = T(BLK, 0.62); tn.fill(fa); over(() => { tn.save(); tn.clip(fa); tn.fillStyle = T(PAPER, 0.32); tn.fillRect(cx0, cy0, cw * 0.42, chh); tn.restore(); });
    kk.save(); kk.strokeStyle = ink(BLK, 0.95); kk.lineWidth = 1.6; kk.stroke(fa); kk.clip(fa);
    kk.lineWidth = 1; for (const u of [0.32, 0.68]) { const [a1, a2] = pt(u, 0.34), [b1, b2] = pt(u, 1); kk.beginPath(); kk.moveTo(a1, a2); kk.lineTo(b1, b2); kk.stroke(); }
    for (let v = 0.4; v < 1; v += 0.06) { const [a1, a2] = pt(0.16, v), [b1, b2] = pt(0.84, v); kk.beginPath(); kk.moveTo(a1, a2); kk.lineTo(b1, b2); kk.stroke(); }
    const [rx, ry] = pt(0.5, 0.56), rr = cw * 0.1; kk.lineWidth = 2; kk.beginPath(); kk.arc(rx, ry, rr, 0, TAU); kk.stroke(); for (let k = 0; k < 12; k++) { const a = k * TAU / 12; kk.beginPath(); kk.moveTo(rx, ry); kk.lineTo(rx + rr * Math.cos(a), ry + rr * Math.sin(a)); kk.stroke(); }
    for (const u of [0.3, 0.5, 0.7]) { const [ax, ay] = pt(u, 0.78), pw = cw * (u === 0.5 ? 0.11 : 0.07); tn.fillStyle = T(BLK, 0.85); tn.beginPath(); tn.moveTo(ax - pw, cy0 + chh); tn.lineTo(ax - pw, ay + pw); tn.arc(ax, ay + pw, pw, Math.PI, 0); tn.lineTo(ax + pw, cy0 + chh); tn.fill(); }
    kk.restore();
    hatchRect(kk, cx0, cy0, cx0 + cw, cy0 + chh, 0.7, 9, 0.8, ink(BLK, 0.22));   // the varnish's craquelure-dark
    gilt(C.x, C.y, C.w, C.h, C.th, z); pictureLight(C.x + C.w / 2, C.y - S(40), S(230), z); }
  { const L = { x: X(-150), y: Y(520), w: S(330), h: S(430), th: S(34) }, cx0 = L.x + L.th, cy0 = L.y + L.th, cw = L.w - 2 * L.th, chh = L.h - 2 * L.th;
    tn.fillStyle = T(BLK, 0.85); tn.fillRect(cx0, cy0, cw, chh);
    const bx = cx0 + cw * 0.58, bust = new Path2D(); bust.moveTo(cx0 + cw * 0.1, cy0 + chh); bust.bezierCurveTo(bx - cw * 0.45, cy0 + chh * 0.66, bx - cw * 0.2, cy0 + chh * 0.6, bx, cy0 + chh * 0.6);
    bust.bezierCurveTo(bx + cw * 0.2, cy0 + chh * 0.6, bx + cw * 0.45, cy0 + chh * 0.66, cx0 + cw * 1.06, cy0 + chh); bust.closePath();
    over(() => { tn.fillStyle = T(PAPER, 0.85); tn.fill(bust); }); kk.save(); kk.clip(bust); kk.fillStyle = ink(BLK, 1); const r0 = rng(8); for (let i = 0; i < 40; i++) kk.fillRect(cx0 + r0() * cw, cy0 + chh * (0.62 + r0() * 0.38), S(4), S(9)); kk.restore();
    tn.fillStyle = T(BLK, 0.55); tn.beginPath(); tn.ellipse(bx, cy0 + chh * 0.42, cw * 0.15, chh * 0.17, 0, 0, TAU); tn.fill();   // the face lost in the varnish
    const cr = new Path2D(), cy1 = cy0 + chh * 0.25, cw2 = cw * 0.17; cr.moveTo(bx - cw2, cy1 + chh * 0.06); for (let k = 0; k <= 4; k++) { const px = bx - cw2 + k * cw2 / 2; cr.lineTo(px, cy1 - (k % 2 ? chh * 0.02 : chh * 0.06)); } cr.lineTo(bx + cw2, cy1 + chh * 0.06); cr.closePath();
    ko.save(); ko.fill(cr); ko.restore(); sp.fillStyle = ink(GOLD, 1); sp.fill(cr); kk.lineWidth = 1.5; kk.strokeStyle = ink(BLK, 1); kk.stroke(cr);
    gilt(L.x, L.y, L.w, L.h, L.th, z); pictureLight(L.x + L.w / 2, L.y - S(30), S(150), z); }
  { const R2 = { x: X(900), y: Y(560), w: S(330), h: S(270), th: S(30) }, cx0 = R2.x + R2.th, cy0 = R2.y + R2.th, cw = R2.w - 2 * R2.th, chh = R2.h - 2 * R2.th;
    const g = tn.createLinearGradient(0, cy0, 0, cy0 + chh); g.addColorStop(0, T(GOLD, 0.5)); g.addColorStop(0.7, T(RED, 0.5)); g.addColorStop(1, T(BLK, 0.7)); tn.fillStyle = g; tn.fillRect(cx0, cy0, cw, chh);
    tn.fillStyle = T(BLK, 0.8); for (const [u, hh] of [[0.2, 0.62], [0.32, 0.5], [0.44, 0.7], [0.56, 0.3]]) tn.fillRect(cx0 + cw * u, cy0 + chh * (1 - hh), cw * 0.06, chh * hh);
    tn.fillRect(cx0 + cw * 0.18, cy0 + chh * 0.34, cw * 0.34, chh * 0.05);
    gilt(R2.x, R2.y, R2.w, R2.h, R2.th, z); pictureLight(R2.x + R2.w / 2, R2.y - S(28), S(150), z); }
  // the pools the picture lights leave on the polished floor
  over(() => { for (const cx of [X(560), X(15), X(1065)]) { const g = tn.createRadialGradient(cx, fl + S(90), 0, cx, fl + S(90), S(260)); g.addColorStop(0, T(PAPER, 0.2)); g.addColorStop(1, T(PAPER, 0)); tn.fillStyle = g; tn.fillRect(cx - S(300), fl, S(600), S(400)); } });
  // the velvet rope on brass posts, behind him
  { const ry = Y(1470), posts = [X(120), X(1000)];
    for (const px of posts) { ko.fillRect(px - S(16), ry - S(40), S(32), fl - ry + S(80)); sp.fillStyle = ink(GOLD, 1); sp.fillRect(px - S(9), ry - S(20), S(18), fl - ry + S(60));
      sp.beginPath(); sp.arc(px, ry - S(26), S(20), 0, TAU); sp.fill(); sp.beginPath(); sp.ellipse(px, fl + S(40), S(60), S(16), 0, 0, TAU); sp.fill();
      kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 2.5; kk.strokeRect(px - S(9), ry - S(20), S(18), fl - ry + S(60)); kk.beginPath(); kk.arc(px, ry - S(26), S(20), 0, TAU); kk.stroke(); kk.beginPath(); kk.ellipse(px, fl + S(40), S(60), S(16), 0, 0, TAU); kk.stroke(); }
    const rope = new Path2D(); rope.moveTo(posts[0], ry); rope.quadraticCurveTo((posts[0] + posts[1]) / 2, ry + S(150), posts[1], ry);
    kk.lineCap = 'round'; kk.lineWidth = S(26); kk.strokeStyle = ink(BLK, 1); kk.stroke(rope); kk.lineWidth = S(20); kk.strokeStyle = ink(RED, 1); kk.stroke(rope);
    sp.lineWidth = S(4); sp.strokeStyle = ink(GOLD, 0.9); sp.save(); sp.translate(0, -S(6)); sp.stroke(rope); sp.restore(); }
  // the guard: back to us, lit only from above by the picture lights (a gold rim), his shadow soft on the parquet
  const gx = X(610), gy = Y(1880), gh = S(1010), sway = Math.sin(t * 1.1) * 0.003;
  tn.fillStyle = T(BLK, 0.6); tn.beginPath(); tn.ellipse(gx, gy - S(6), S(150), S(26), 0, 0, TAU); tn.fill();
  rimmed(guardBack(gx, gy, gh, sway), 0, -5, 7, 1);
  motes(12, 40, t, 10, 14, 0.9);
  return { cell: 9, misreg: 1.6 + 7 * Math.exp(-age * 7) + (b >= 6 ? 6 * Math.exp(-(b - 6) * 7) : 0) };
}
// 16-18 SOLDIERS SHIPPED OUT. (v9, Klutsis' scale collision): from the pier, low, the troopship's hull fills the frame
// and runs away to the right; her rail is packed with helmets against the bright sky (hundreds of backs and shoulders
// at crowd scale, never a doll), the hawser still on the bollard, and she is moving: the plating slides past.
function shotPier(b, t) {
  const age = b - 16, go = age * 0.018 + 0.02 * ease.inCubic(clamp(age / 2)), kz = 3.2;
  const pr = u => u / (u + (1 - u) * kz), xA = -80, xB = 1180 + 40 * Math.exp(-age * 5);
  const X = u => lerp(xA, xB, pr(u)), TOP = u => lerp(330, 790, pr(u)), BOT = u => lerp(2080, 1300, pr(u));
  // the sky: bright stock, the low sun behind her upper works, gold toward the horizon
  const g = tn.createLinearGradient(0, 0, 0, 1300); g.addColorStop(0, T(GOLD, 0.25)); g.addColorStop(1, T(GOLD, 0.75)); tn.fillStyle = g; tn.fillRect(0, 0, W, 1320);
  over(() => { const s = tn.createRadialGradient(900, 520, 0, 900, 520, 700); s.addColorStop(0, T(PAPER, 1)); s.addColorStop(0.3, T(PAPER, 0.7)); s.addColorStop(1, T(PAPER, 0)); tn.fillStyle = s; tn.fillRect(0, 0, W, 1320); });
  clouds(16, 5, 120, 600, t * 40, BLK, 0.1, 1.2);
  // the funnel and upper works beyond the rail, far end, and her smoke
  const fxu = 0.55, fx = X(fxu), ft = TOP(fxu);
  const up = new Path2D(); up.moveTo(fx - 46, ft - 60); up.lineTo(fx - 30, ft - 430); up.lineTo(fx + 60, ft - 430); up.lineTo(fx + 56, ft - 60); up.closePath();   // one raked funnel, no stepped decks
  up.rect(X(0.25) - 4, TOP(0.25) - 560, 8, 560); up.rect(X(0.8) - 3, TOP(0.8) - 380, 6, 380);
  tn.fillStyle = T(BLK, 0.8); tn.fill(up); kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 2; kk.stroke(up);
  for (let i = 0; i < 8; i++) { const q = (t * 0.4 + i / 8) % 1, px = fx + 5 - q * 500, py = ft - 440 - q * 260, rr = 40 + q * 170;
    over(() => { const gg = tn.createRadialGradient(px, py, 0, px, py, rr); gg.addColorStop(0, T(PAPER, 0.6 * (1 - q))); gg.addColorStop(1, T(PAPER, 0)); tn.fillStyle = gg; tn.fillRect(px - rr, py - rr, rr * 2, rr * 2); });
    tn.fillStyle = T(BLK, 0.16 * (1 - q)); tn.beginPath(); tn.arc(px + rr * 0.2, py + rr * 0.2, rr * 0.7, 0, TAU); tn.fill(); }
  // the rail: the packed helmets, heads and shoulders, perspective-scaled, a sway with the swell
  { const men = new Path2D(), r = rng(1616);
    // v9b: two ranks, each man a readable head: an M1 dome with its brim, a neck, then the shoulders, so the sky shows
    // beside every neck (the v9a three-deep stack merged into one scalloped mound)
    for (let u = 0.004; u < 1; ) { const sc = lerp(1, 0.2, pr(u)), hr = 40 * sc, x = X(u), yd = TOP(u);
      for (let d = 1; d >= 0; d--) { const hx = x + d * hr * 1.45 + (r() - 0.5) * hr * 0.3, y = yd - hr * (2.5 + d * 1.1) + Math.sin(t * 2.3 + u * 40 + d) * hr * 0.1, rh = hr * (0.92 + r() * 0.14);
        const sh = y + rh * 1.55;   // shoulder line
        men.moveTo(hx - rh * 1.9, yd + 4); men.lineTo(hx - rh * 1.9, sh + rh * 0.5); men.quadraticCurveTo(hx - rh * 1.8, sh, hx - rh * 0.9, sh); men.lineTo(hx - rh * 0.42, sh - rh * 0.1);
        men.lineTo(hx - rh * 0.42, y + rh * 0.6); men.lineTo(hx + rh * 0.42, y + rh * 0.6); men.lineTo(hx + rh * 0.42, sh - rh * 0.1); men.lineTo(hx + rh * 0.9, sh);
        men.quadraticCurveTo(hx + rh * 1.8, sh, hx + rh * 1.9, sh + rh * 0.5); men.lineTo(hx + rh * 1.9, yd + 4); men.closePath();
        men.moveTo(hx + rh * 0.8, y + rh * 0.2); men.ellipse(hx, y + rh * 0.2, rh * 0.8, rh * 0.75, 0, 0, TAU);   // the head under the rim
        men.moveTo(hx - rh * 1.25, y); men.ellipse(hx, y, rh * 1.05, rh * 0.95, 0, Math.PI, 0); men.lineTo(hx + rh * 1.25, y + rh * 0.12); men.lineTo(hx - rh * 1.25, y + rh * 0.12); men.closePath();   // the M1 dome and brim
        if (r() < 0.12) { men.moveTo(hx + rh * 1.2, sh + rh * 0.4); men.lineTo(hx + rh * 1.6, y - rh * 2.6); men.lineTo(hx + rh * 1.85, y - rh * 2.6); men.lineTo(hx + rh * 1.55, sh + rh * 0.4); men.closePath(); }   // a slung rifle's muzzle
        if (d === 0 && r() < 0.07) { men.moveTo(hx - rh * 1.5, sh + rh * 0.2); men.lineTo(hx - rh * 2.3, y - rh * 1.6); men.lineTo(hx - rh * 1.8, y - rh * 1.8); men.lineTo(hx - rh * 1.0, sh); men.closePath();   // an arm up: a wave to the pier
          men.moveTo(hx - rh * 2.05 + rh * 0.45, y - rh * 1.95); men.ellipse(hx - rh * 2.05, y - rh * 1.95, rh * 0.45, rh * 0.45, 0, 0, TAU); } }
      u += (hr * 2.9) / Math.max(20, X(u + 0.01) - X(u)) * 0.01; }
    rimmed([men], 0, -4, 4, 1); }
  // the hull: one plane of plate running away from the pier; strakes and butts converge; ports; she slides past
  const hull = new Path2D(); hull.moveTo(X(0), TOP(0)); for (let k = 1; k <= 40; k++) { const u = k / 40; hull.lineTo(X(u), TOP(u)); } for (let k = 40; k >= 0; k--) { const u = k / 40; hull.lineTo(X(u), BOT(u)); } hull.closePath();
  tn.fillStyle = T(BLK, 0.86); tn.fill(hull); kk.fillStyle = ink(BLK, 0.7); kk.fill(hull);
  kk.save(); kk.clip(hull); kk.globalCompositeOperation = 'destination-out'; kk.strokeStyle = '#000'; kk.lineWidth = 2.2;
  for (let v = 0.12; v < 1; v += 0.11) { kk.beginPath(); for (let k = 0; k <= 40; k++) { const u = k / 40, x = X(u), y = lerp(TOP(u), BOT(u), v); k ? kk.lineTo(x, y) : kk.moveTo(x, y); } kk.stroke(); }
  for (let j = -1; j < 60; j++) { const u = ((j * 0.035 - go) % 1 + 1) % 1; if (u > 0.98) continue; const vv = (j % 3) * 0.11 + 0.12; kk.lineWidth = lerp(2.4, 0.8, pr(u));
    kk.beginPath(); kk.moveTo(X(u), lerp(TOP(u), BOT(u), vv)); kk.lineTo(X(u), lerp(TOP(u), BOT(u), vv + 0.33)); kk.stroke(); }
  kk.restore();
  for (let j = 0; j < 44; j++) { const u = ((j * 0.024 - go) % 1 + 1) % 1; if (u > 0.95) continue; const x = X(u), y = lerp(TOP(u), BOT(u), 0.2), rr = lerp(15, 3, pr(u));
    ko.beginPath(); ko.arc(x, y, rr + 3, 0, TAU); ko.fill(); if ((j * 7) % 3 < 1.4) { sp.fillStyle = ink(GOLD, 1); sp.beginPath(); sp.arc(x, y, rr, 0, TAU); sp.fill(); } else { kk.fillStyle = ink(BLK, 1); kk.beginPath(); kk.arc(x, y, rr * 0.7, 0, TAU); kk.fill(); } }
  // the deck edge: the rail line, a gold rim from the low sun, the stanchions
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 7; kk.beginPath(); for (let k = 0; k <= 40; k++) { const u = k / 40; k ? kk.lineTo(X(u), TOP(u) - 26 * lerp(1, 0.2, pr(u))) : kk.moveTo(X(u), TOP(u) - 26); } kk.stroke();
  sp.strokeStyle = ink(GOLD, 1); sp.lineWidth = 4; sp.beginPath(); for (let k = 0; k <= 40; k++) { const u = k / 40; k ? sp.lineTo(X(u), TOP(u) - 3) : sp.moveTo(X(u), TOP(u) - 3); } sp.stroke();
  ko.strokeStyle = PAPER; ko.lineWidth = 6; ko.stroke(new Path2D(`M${X(0)} ${TOP(0) - 3} L${X(1)} ${TOP(1) - 3}`));
  // the stencilled hull number, running with the plate
  { const u0 = ((0.12 - go) % 1 + 1) % 1; if (u0 < 0.6) { const a = [X(u0), lerp(TOP(u0), BOT(u0), 0.36)], c = [X(u0 + 0.1), lerp(TOP(u0 + 0.1), BOT(u0 + 0.1), 0.36)], d = [X(u0), lerp(TOP(u0), BOT(u0), 0.5)];
    ko.save(); ko.setTransform((c[0] - a[0]) / 300, (c[1] - a[1]) / 300, (d[0] - a[0]) / 110, (d[1] - a[1]) / 110, a[0], a[1]); ko.font = '700 110px "Oswald"'; ko.textBaseline = 'top'; ko.textAlign = 'left'; ko.fillStyle = PAPER; ko.fillText('AP-117', 0, 0); ko.restore(); } }
  // the pier: the edge in the foreground, a bollard, the hawser rising taut to her bow
  tn.fillStyle = T(BLK, 0.92); tn.beginPath(); tn.moveTo(0, 1760); tn.lineTo(W, 1640); tn.lineTo(W, H); tn.lineTo(0, H); tn.fill();
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 3; kk.beginPath(); kk.moveTo(0, 1760); kk.lineTo(W, 1640); kk.stroke();
  const bol = new Path2D(); bol.rect(640, 1792, 300, 30);   // a double bitt on its base plate (two short posts with caps), the hawser in a figure-eight
  for (const px of [700, 880]) { bol.rect(px - 32, 1700, 64, 94); bol.ellipse(px, 1700, 46, 16, 0, 0, TAU); }
  rimmed([bol], 0, -3, 4, 1);
  kk.lineWidth = 12; kk.beginPath(); kk.moveTo(700, 1700); kk.lineTo(880, 1760); kk.moveTo(880, 1700); kk.lineTo(700, 1760); kk.moveTo(700, 1700); kk.quadraticCurveTo(600, 1300 + 20 * Math.sin(t), X(0.03), TOP(0.03) + 120); kk.stroke();
  sp.strokeStyle = ink(GOLD, 0.8); sp.lineWidth = 3; sp.beginPath(); sp.moveTo(702, 1694); sp.quadraticCurveTo(600, 1294 + 20 * Math.sin(t), X(0.03), TOP(0.03) + 114); sp.stroke();
  motes(16, 30, t, 60, -10, 0.8);
  return { cell: 9, misreg: 1.8 + 5 * Math.exp(-age * 6) };
}
// 16-20 SOLDIERS SHIPPED OUT.: a troopship heads east, her rails lined with soldiers against the last light; the routes
// fan out from the ports across the globe behind her
const PORTS = [[-76.3, 36.9], [-117.2, 32.7], [-79.9, 32.8], [-122.4, 47.6], [-74.0, 40.6]];
function shotSoldiers(b, t) {
  if (b < 18) return shotPier(b, t);
  const u = (b - 16) / 4, P = ortho(lerp(-62, -30, ease.inOutCubic(u)), lerp(34, 38, u), lerp(560, 520, u) * (1 + 0.06 * Math.exp(-(b - 16) * 5) + 0.06 * (b >= 18 ? Math.exp(-(b - 18) * 5) : 0)), 540, 900, 0);
  globe(P, { land: LAND110, sea: 0.64, beat: b, grat: 0.8 });
  lights(P, (lo2, la2) => facing(P, lo2, la2), b, { k: 0.7, minPop: 150000 });
  const go = clamp((b - 16.3) / 3.2);
  bases.forEach((x, i) => {
    if (i % 5) return;
    if (facing(P, x.lo, x.la)) { const [px, py] = P([x.lo, x.la]); basePin(px, py, 4.5); }
    const st = (i * 0.618) % 1 * 0.5, uu = clamp((go - st) / 0.5); if (uu <= 0) return;
    const port = PORTS[i % PORTS.length], rt = geoInterpolate(port, [x.lo, x.la]);
    arcOnGlobe(P, rt, Math.max(0, uu - 0.4), uu, 0.1, 2.2, 16);
  });
  // the last light behind the ship: a red-gold band on the horizon under the globe
  over(() => { const g = tn.createLinearGradient(0, 1150, 0, 1520); g.addColorStop(0, T(GOLD, 0)); g.addColorStop(0.6, T(GOLD, 0.7)); g.addColorStop(1, T(PAPER, 0.9)); tn.fillStyle = g; tn.fillRect(0, 1150, W, 370); });
  // v9: no ship under the globe; the troopship is the pier shot (b16-18). Here the arcs fan out, gold like the mills'
  return { cell: 9, misreg: 1.8 + 5 * Math.exp(-(b - 16) * 6) + (b >= 18 ? 6 * Math.exp(-(b - 18) * 6) : 0) };
}
// a troopship in side view against the last light: one key-plate silhouette (hull, superstructure, funnel, masts,
// boats), gold rim on her upper edges, the rails lined with soldiers, smoke in paper, the sea glinting under the light
function troopship(x0, wl, s, b, t) {
  const L = 1500 * s, D = 150 * s, deckY = wl - D, P = new Path2D();
  P.moveTo(x0, deckY); P.lineTo(x0 + L * 0.93, deckY - D * 0.12); P.quadraticCurveTo(x0 + L, deckY - D * 0.1, x0 + L * 0.985, wl + 20);
  P.lineTo(x0 + 30, wl + 20); P.quadraticCurveTo(x0 - 15, wl - D * 0.5, x0, deckY); P.closePath();
  const sx = x0 + L * 0.3, sw = L * 0.42;
  for (const [x, y, w, h] of [[sx, deckY - 70 * s, sw, 70 * s], [sx + sw * 0.1, deckY - 130 * s, sw * 0.75, 60 * s], [sx + sw * 0.28, deckY - 175 * s, sw * 0.35, 45 * s]]) P.rect(x, y, w, h + 2);
  const fx = sx + sw * 0.45, fy = deckY - 175 * s; P.rect(fx, fy - 110 * s, 70 * s, 112 * s);
  for (const mx of [x0 + L * 0.12, x0 + L * 0.85]) P.rect(mx - 3, deckY - 300 * s, 6, 300 * s);
  for (let i = 0; i < 6; i++) { const bx = sx + 20 + i * sw / 6; P.moveTo(bx + 60 * s, deckY - 80 * s); P.ellipse(bx + 30 * s, deckY - 80 * s, 30 * s, 9 * s, 0, 0, TAU); }
  // smoke first (behind), paper puffs with a grey core
  for (let i = 0; i < 9; i++) { const q = ((t * 0.5 + i / 9) % 1), px = fx + 35 * s - q * 380 * s, py = fy - 120 * s - q * 200 * s - Math.sin(i) * 20, rr = (30 + q * 120) * s;
    over(() => { const gg = tn.createRadialGradient(px, py, 0, px, py, rr); gg.addColorStop(0, T(PAPER, 0.7 * (1 - q))); gg.addColorStop(1, T(PAPER, 0)); tn.fillStyle = gg; tn.fillRect(px - rr, py - rr, rr * 2, rr * 2); });
    tn.fillStyle = T(BLK, 0.14 * (1 - q)); tn.beginPath(); tn.arc(px + rr * 0.2, py + rr * 0.25, rr * 0.7, 0, TAU); tn.fill(); }
  // the soldiers at the rails: backs and shoulders, packs on, a few rifles, a sway with the swell
  // v8: crowd scale, not dolls. Hundreds of helmeted heads and shoulders packed along every rail (8-14 px heads at the
  // wide shot), two and three deep, bobbing with the swell
  const men = new Path2D(), heads = new Path2D(), domes = new Path2D(), guns = new Path2D(), r = rng(16), hr = 4.2 * s;
  const row = (xa, xb, fy2, deep = 2) => { for (let d = 0; d < deep; d++) for (let x = xa + r() * hr; x < xb; x += hr * (2.3 + r() * 0.8)) {
    const y = fy2 - d * hr * 0.9 + Math.sin(t * 2.2 + x * 0.05) * hr * 0.12, hx = x + d * hr * 0.8, rh = hr * (0.9 + r() * 0.2);
    men.moveTo(hx - rh * 1.9, y + rh * 12); men.lineTo(hx - rh * 1.9, y + rh * 1.6); men.quadraticCurveTo(hx - rh * 1.6, y + rh * 0.9, hx, y + rh * 0.9); men.quadraticCurveTo(hx + rh * 1.6, y + rh * 0.9, hx + rh * 1.9, y + rh * 1.6); men.lineTo(hx + rh * 1.9, y + rh * 12); men.closePath();
    heads.moveTo(hx + rh, y); heads.ellipse(hx, y, rh, rh * 1.05, 0, 0, TAU);
    domes.moveTo(hx - rh * 1.15, y - rh * 0.35); domes.ellipse(hx, y - rh * 0.35, rh * 1.15, rh * 0.95, 0, Math.PI, 0); domes.closePath();   // the M1 dome
    if (r() < 0.12) { guns.moveTo(hx + rh * 1.2, y + rh); guns.lineTo(hx + rh * 1.2 + rh * 0.9, y - rh * 3.2); guns.lineTo(hx + rh * 1.5 + rh * 0.9, y - rh * 3.2); guns.lineTo(hx + rh * 1.5, y + rh); guns.closePath(); } } };
  row(x0 + L * 0.02, x0 + L * 0.3, deckY - 40 * s, 2); row(x0 + L * 0.72, x0 + L * 0.93, deckY - L * 0.004 - 40 * s, 2);
  row(sx + 8, sx + sw - 8, deckY - 88 * s, 2); row(sx + sw * 0.12, sx + sw * 0.83, deckY - 148 * s, 2); row(sx + sw * 0.3, sx + sw * 0.6, deckY - 190 * s, 1);
  rimmed([P, men, heads, domes, guns], 0, -4, 4, 1);
  // hull plating and portholes cut from the black: strakes, butts, a row of lit ports
  kk.save(); kk.globalCompositeOperation = 'destination-out'; kk.strokeStyle = '#000'; kk.lineWidth = Math.max(1, 1.1 * s);
  kk.save(); kk.clip(P); for (let k = 1; k < 5; k++) { const y = deckY + D * k / 5; kk.beginPath(); kk.moveTo(x0, y); kk.lineTo(x0 + L, y - D * 0.1 * (1 - k / 5)); kk.stroke(); }
  for (let x = x0 + 40 * s; x < x0 + L * 0.97; x += 36 * s) { const k = Math.floor((x - x0) / (36 * s)) % 5, y = deckY + D * k / 5; kk.beginPath(); kk.moveTo(x, y); kk.lineTo(x, y + D / 5); kk.stroke(); }
  kk.restore(); kk.restore();
  for (let x = x0 + 60 * s; x < x0 + L * 0.95; x += 26 * s) { const y = deckY + D * 0.3; ko.beginPath(); ko.arc(x, y, 4.5 * s, 0, TAU); ko.fill();
    kk.save(); kk.globalCompositeOperation = 'destination-out'; kk.beginPath(); kk.arc(x, y, 4 * s, 0, TAU); kk.fill(); kk.restore();
    if ((x * 7) % 3 < 1.6) { sp.fillStyle = ink(GOLD, 1); sp.beginPath(); sp.arc(x, y, 3.4 * s, 0, TAU); sp.fill(); } }
  // the rail and its stanchions, in front of the men
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = Math.max(3, 2 * s); kk.beginPath(); kk.moveTo(x0 + 10, deckY - 36 * s); kk.lineTo(x0 + L * 0.93, deckY - 36 * s - D * 0.1); kk.stroke();
  kk.lineWidth = Math.max(1.5, s); for (let x = x0 + 20; x < x0 + L * 0.93; x += 30 * s) { kk.beginPath(); kk.moveTo(x, deckY - 36 * s - D * 0.1 * (x - x0) / L); kk.lineTo(x, deckY); kk.stroke(); }
  // the sea: black, with paper glints where the light lies on it
  tn.fillStyle = T(BLK, 0.8); tn.fillRect(0, wl + 12, W, H - wl);
  const s2 = rng(5);
  for (let i = 0; i < 80; i++) { const y = wl + 20 + Math.pow(s2(), 1.4) * (H - wl), x = ((s2() * W - t * 60 * (1 + (y - wl) / 200)) % (W + 200) + W + 200) % (W + 200) - 100, w = 30 + (y - wl) * 0.4;
    ko.lineWidth = 2 + (y - wl) * 0.015; ko.beginPath(); ko.moveTo(x, y); ko.quadraticCurveTo(x + w / 2, y - 5, x + w, y); ko.stroke();
    if (i % 3 === 0) { sp.strokeStyle = ink(GOLD, 0.8); sp.lineWidth = ko.lineWidth * 0.7; sp.stroke(); } }
}
// 20-24 THE MILLS? / SHIPPED OUT.  and 46 THE MILLS? (lit): the steel belt on the real map
function usMapBase(A, o = {}) {
  const { night = 0, landA = 0.95, state = null, stateA = 0, labels = 1, relief = 1, wl = 1 } = o;
  tn.fillStyle = T(BLK, lerp(0.6, 0.9, night)); tn.fillRect(0, 0, W, H);
  const NP = P2(A, NEIGH); over(() => { tn.fillStyle = '#fff'; tn.fill(NP); }); tn.fillStyle = T(BLK, 0.22 + 0.45 * night); tn.fill(NP);   // neighbours: stone, never red
  const UP = P2(A, US48); over(() => { tn.fillStyle = T(RED, landA); tn.fill(UP); }); if (night) { tn.fillStyle = T(BLK, 0.6 * night); tn.fill(UP); }
  if (state && stateA > 0) { const S2 = P2(A, byState[state]); over(() => { tn.fillStyle = T(PAPER, stateA); tn.fill(S2); }); tn.fillStyle = T(GOLD, stateA); tn.fill(S2); }
  over(() => { const sg = tn.createLinearGradient(0, 0, W, H); sg.addColorStop(0, T(PAPER, 0.1)); sg.addColorStop(1, T(PAPER, 0)); tn.fillStyle = sg; tn.fillRect(0, 0, W, H); });
  sp.strokeStyle = ink(GOLD, 0.8); sp.lineWidth = 1.3; sp.stroke(P2(A, GRAT));
  const CP = P2(A, COAST48);
  if (wl) waterlines(P2(A, { type: 'FeatureCollection', features: [...STATES, ...NEIGH.features] }), [6, 12, 19], wl * (1 - night * 0.6));
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 2.6; kk.stroke(CP); if (NP) { kk.lineWidth = 1.6; kk.stroke(NP); }
  kk.setLineDash([7, 5]); kk.lineWidth = 1.5; kk.strokeStyle = ink(BLK, 0.85); kk.stroke(P2(A, STATE_LINES)); kk.setLineDash([]);
  if (relief) {
    kk.strokeStyle = ink(BLK, 0.8); kk.lineWidth = 1.3;
    for (const rd of RIDGES) for (let i = 0; i < rd.length - 1; i++) {
      const [x0, y0] = A(rd[i]), [x1, y1] = A(rd[i + 1]), n = Math.max(2, Math.hypot(x1 - x0, y1 - y0) / 7), nx = -(y1 - y0), ny = x1 - x0, nn = Math.hypot(nx, ny) || 1;
      for (let k = 0; k < n; k++) { const f = k / n, x = lerp(x0, x1, f), y = lerp(y0, y1, f), l = 7 + 9 * Math.abs(Math.sin(k * 1.7 + i));
        kk.beginPath(); kk.moveTo(x + nx / nn * 3, y + ny / nn * 3); kk.lineTo(x + nx / nn * l, y + ny / nn * l); kk.moveTo(x - nx / nn * 3, y - ny / nn * 3); kk.lineTo(x - nx / nn * l * 0.7, y - ny / nn * l * 0.7); kk.stroke(); }
    }
    kk.lineWidth = 2; kk.strokeStyle = ink(BLK, 0.9);
    for (const rv of RIVERS) { kk.beginPath(); rv.forEach((q, i) => { const [x, y] = A(q); const [wx, wy] = wob(x, y, 2); i ? kk.lineTo(wx, wy) : kk.moveTo(wx, wy); }); kk.stroke(); }
  }
  if (labels) {
    kk.fillStyle = ink(BLK, 1); kk.font = '600 17px "Plex Mono"'; kk.textAlign = 'left';
    for (let i = 0; i < 60; i++) { const [n, st, la, lo] = CITY[i]; if (n === 'Brooklyn' || n === 'Queens' || n === 'Manhattan' || n === 'The Bronx') continue;
      const [x, y] = A([lo, la]); if (x < 10 || x > W - 60 || y < 20 || y > H - 20) continue;
      ko.beginPath(); ko.arc(x, y, 5, 0, TAU); ko.fill(); kk.beginPath(); kk.arc(x, y, 4, 0, TAU); kk.fill(); kk.fillText(n.toUpperCase(), x + 8, y - 6); }
  }
}
function millGlyph(x, y, s, lit, b, t, i) {
  // a sawtooth shed, a furnace and two stacks, printed as a small engraving
  tn.fillStyle = T(BLK, lit ? 0.7 : 0.88);
  tn.fillRect(x - 26 * s, y - 14 * s, 52 * s, 14 * s); tn.fillRect(x - 20 * s, y - 42 * s, 5 * s, 28 * s); tn.fillRect(x - 11 * s, y - 50 * s, 5 * s, 36 * s); tn.fillRect(x + 12 * s, y - 30 * s, 12 * s, 16 * s);
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 1.4; kk.beginPath();
  for (let k = 0; k < 5; k++) { const x0 = x - 26 * s + k * 10.4 * s; kk.moveTo(x0, y - 14 * s); kk.lineTo(x0 + 10.4 * s, y - 20 * s); kk.lineTo(x0 + 10.4 * s, y - 14 * s); }
  kk.rect(x - 26 * s, y - 14 * s, 52 * s, 14 * s); kk.rect(x - 20 * s, y - 42 * s, 5 * s, 28 * s); kk.rect(x - 11 * s, y - 50 * s, 5 * s, 36 * s); kk.stroke();
  if (lit) {
    for (let k = 0; k < 3; k++) { ko.fillRect(x - 22 * s + k * 16 * s, y - 10 * s, 10 * s, 6 * s); sp.fillStyle = ink(GOLD, 1); sp.fillRect(x - 22 * s + k * 16 * s, y - 10 * s, 10 * s, 6 * s); }
    for (const sx of [x - 17.5 * s, x - 8.5 * s]) for (let k = 0; k < 5; k++) { const q = (t * 0.7 + k / 5 + i * 0.13) % 1, px = sx + q * 30 * s, py = y - 52 * s - q * 60 * s, rr = (4 + q * 12) * s;
      over(() => { tn.fillStyle = T(PAPER, 0.75 * (1 - q)); tn.beginPath(); tn.arc(px, py, rr, 0, TAU); tn.fill(); }); tn.fillStyle = T(RED, 0.3 * (1 - q)); tn.beginPath(); tn.arc(px, py + rr * 0.4, rr * 0.8, 0, TAU); tn.fill(); }
  }
}
function shotMillsMap(b, t, lit) {
  const b0 = lit ? 46 : 20, u = (b - b0) / (lit ? 1 : 4), pin = lit ? 0 : ease.outExpo(clamp((b - 22) / 0.2));   // b22: punch in on Youngstown
  const A = albers(lerp(lerp(-82.6, -81.8, u), -80.9, pin), lerp(lerp(41.2, 41.0, u), 41.0, pin), lerp(5400, 5900, u) * (1 + 0.06 * Math.exp(-(b - b0) * 5)) * (1 + 1.4 * pin), 540, lerp(900, 1420, pin));
  usMapBase(A, { night: lit ? 0.2 : 0.35, landA: lit ? 0.9 : 0.42 });   // v9: the 60% pre-turn red (full red only after b32)
  const gone = lit ? 0 : ease.outCubic(clamp((b - 20.3) / 3.2));
  // the red drains out of the mill towns: a paper-grey stain spreads from each works as it goes dark
  if (!lit && gone > 0) MILLS.forEach(([n, la, lo], i) => { const [x, y] = A([lo, la]), rr = 50 + 170 * clamp(gone * 1.2 - (i % 5) * 0.06);
    over(() => { const g = tn.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, T(PAPER, 0.7)); g.addColorStop(0.6, T(PAPER, 0.35)); g.addColorStop(1, T(PAPER, 0)); tn.fillStyle = g; tn.fillRect(x - rr, y - rr, 2 * rr, 2 * rr); });
    const g2 = tn.createRadialGradient(x, y, 0, x, y, rr); g2.addColorStop(0, T(BLK, 0.3)); g2.addColorStop(1, T(BLK, 0)); tn.fillStyle = g2; tn.fillRect(x - rr, y - rr, 2 * rr, 2 * rr); });
  MILLS.forEach(([n, la, lo], i) => {
    const [x, y] = A([lo, la]); if (x < -80 || x > W + 80 || y < -80 || y > H + 80) return;
    if (!lit && gone > 0) {   // the mill's light lifts off and flies EAST off the sheet, a gold arc like the troopship's
      const tx = W + 260, ty = y - 300 + 160 * Math.sin(i * 1.7), uu = clamp(gone * 1.4 - (i % 7) * 0.06);
      const pts = []; for (let k = 0; k <= 22; k++) { const f = k / 22 * uu; pts.push([lerp(x, tx, f), lerp(y, ty, f) - Math.sin(Math.PI * f) * 220]); }
      if (uu > 0.02) { cased(pts, 4, 3); const hd = pts.at(-1); if (uu < 1) { ko.beginPath(); ko.arc(hd[0], hd[1], 10, 0, TAU); ko.fill(); sp.fillStyle = ink(GOLD, 1); sp.beginPath(); sp.arc(hd[0], hd[1], 7, 0, TAU); sp.fill(); } }
    }
    kk.globalAlpha = 1 - gone * 0.7; tn.globalAlpha = 1 - gone * 0.75;
    const dying = !lit && i === 0 && b < 23.2;   // Youngstown's furnace still lit on the punch, then it goes out
    if (dying) { tn.globalAlpha = 1; kk.globalAlpha = 1; sp.globalAlpha = 1 - clamp((b - 22.4) / 0.8); }
    millGlyph(x, y, 1.55 * (1 + 0.8 * pin * (i === 0)), lit || dying, b, t, i); sp.globalAlpha = 1;
    kk.globalAlpha = 1; tn.globalAlpha = 1;
    kk.fillStyle = ink(BLK, 1 - gone * 0.5); kk.font = '700 19px "Oswald"'; kk.textAlign = 'center'; kk.fillText(n, x, y + 24);
  });
  if (lit) legend(b, 0, ['U.S. INSTALLATIONS', 'ABROAD'], b >= 46.9);
  return { cell: 9, misreg: 1.6 };
}
// 24-28 BANKS CASHED IN.: the host countries gild; every base threads to the money centres.
// 28-30 (no words): the globe turns west and every gold thread converges on one gold point on lower Manhattan.
// 30-32 the press freezes on that frame and shakes harder under the roll; the one silence is b31.5-32.
const NYC = [-74.01, 40.71];
function shotGold(b, t, noTemple = false) {
  const frz = b >= 30, bb = frz ? 30 : b, tt = frz ? 15 : t;
  if (bb >= 28.5 && !noTemple) return shotExchange(b, bb, tt, frz);   // v9: the temple prints half a beat earlier; the frieze reads b28.5-30
  const turn = ease.inOutCubic(clamp((bb - 25) / 4.6)) * 0.62 + 0.38 * ease.outExpo(clamp((bb - 26) / 0.25));   // the punch on b26
  const P = ortho(lerp(52, -34, turn), lerp(30, 40, turn), lerp(560, 660, turn) * (1 + 0.05 * Math.exp(-(bb - 24) * 5)) * (1 + 0.05 * (bb >= 28 ? Math.exp(-(bb - 28) * 5) : 0)), 540, 900);
  globe(P, { land: LAND110, sea: 0.7, beat: bb, hosts: 0.6, grat: 0.8 });
  const kick = frz ? 0 : B.env('kick', bb * B.spb, 7);
  // the threads: first to the nearest money centre (24-28), then all of them to Wall Street (28-30)
  const th = clamp((bb - 24.5) / 1.2) * (1 - clamp((bb - 27.6) / 0.6)), tn2 = ease.inOutCubic(clamp((bb - 28) / 1.6));
  bases.forEach((x, i) => { if (i % 6) return;
    if (th > 0) { let best = FIN[0], bd = 9; for (const f of FIN) { const d = geoDistance(f, [x.lo, x.la]); if (d < bd) { bd = d; best = f; } }
      arcOnGlobe(P, geoInterpolate([x.lo, x.la], best), 0, th, 0.05, 5, 10, tbill); }
    if (tn2 > 0) arcOnGlobe(P, geoInterpolate([x.lo, x.la], NYC), Math.max(0, tn2 - 0.55), tn2, 0.07, 5.5, 14, tbill); });
  for (const x of bases) {
    if (!facing(P, x.lo, x.la)) continue; const [px, py] = P([x.lo, x.la]);
    basePin(px, py, 6 + kick * 1.5, 1);
  }
  if (th > 0) for (const [lo2, la2] of FIN) if (facing(P, lo2, la2)) { const [x, y] = P([lo2, la2]); noteStack(x, y, 0.6 + 0.6 * th); }
  if (facing(P, ...NYC)) {   // the one gold point, and its hand-set micro label
    const [x, y] = P(NYC), g = tn2, rr = 10 + 26 * g + 6 * Math.sin(tt * 6) * g;
    over(() => { const gg = tn.createRadialGradient(x, y, 0, x, y, rr * 6); gg.addColorStop(0, T(GOLD, 1)); gg.addColorStop(0.3, T(GOLD, 0.6 * g)); gg.addColorStop(1, T(GOLD, 0)); tn.fillStyle = gg; tn.fillRect(x - rr * 6, y - rr * 6, rr * 12, rr * 12); });
    ko.beginPath(); ko.arc(x, y, rr + 4, 0, TAU); ko.fill(); sp.fillStyle = ink(GOLD, 1); sp.beginPath(); sp.arc(x, y, rr, 0, TAU); sp.fill();
    kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 3; kk.beginPath(); kk.arc(x, y, rr + 8, 0, TAU); kk.stroke();
    if (g > 0.3) { kk.font = '600 22px "Plex Mono"'; kk.textAlign = 'right'; ko.fillRect(x - rr - 150, y - 16, 128, 26); kk.fillStyle = ink(BLK, 1); kk.fillText('WALL ST', x - rr - 26, y + 3); }
  }
  legend(bb, 750);
  const shake = frz ? 1.5 + 9 * clamp((b - 30) / 1.5) ** 2 : 0;
  return { cell: 9, misreg: 1.6, shake, freeze: frz };
}
// 29-32 (no words): the threads land on a columned exchange front that rhymes with the b4 museum: two temples under
// guard. It prints on b29, every gold thread converges on its frieze (WALL ST cut in the stone), and at b30 the press
// freezes and shakes harder to the silence at b31.5.
function shotExchange(b, bb, tt, frz) {
  // v9: on b30 the camera cuts in between the columns (the stencil leaves the top of the frame) and the press freezes
  // there, black gaps and bare-stock columns, the T-bill threads plunging in; the shake grows to the silence at b31.5
  const age = bb - 28.5, pr = ease.outExpo(clamp(age / 0.2)), z = frz ? 3.25 : 1 + 0.1 * Math.exp(-age * 6) + age * 0.04;
  const gy = tn.createLinearGradient(0, 0, 0, H); gy.addColorStop(0, T(BLK, 0.85)); gy.addColorStop(0.55, T(GOLD, 0.9)); gy.addColorStop(1, T(BLK, 0.7));
  tn.fillStyle = gy; tn.fillRect(0, 0, W, H);
  over(() => { const g = tn.createRadialGradient(540, 700, 0, 540, 700, 700); g.addColorStop(0, T(PAPER, 0.8)); g.addColorStop(1, T(PAPER, 0)); tn.fillStyle = g; tn.fillRect(0, 0, W, H); });
  const fy = frz ? 1265 : 1500, X = x => 540 + (x - 540) * z, Y = y => fy + (y - fy) * z;
  const fr = templeFront(X(540), Y(1560), 1000 * z, 1180 * z, { tone: T(PAPER, 0.9), keyA: pr, cols: 6, lw: 4, ent: 0.27 });
  // the threads: from every edge of the sheet into the frieze
  const tgt = [(fr.x1 + fr.x2) / 2, (fr.y1 + fr.y2) / 2 - 10], r = rng(2929), n = 70, u = ease.inOutCubic(clamp((age + 0.3) / 0.7));
  for (let i = 0; i < n; i++) {
    const side = i % 3, s0 = side === 0 ? [r() * W, -40] : side === 1 ? [-40, r() * 1300] : [W + 40, r() * 1300];
    const bend = (r() - 0.5) * 500, pts = [];
    for (let k = 0; k <= 18; k++) { const f = k / 18 * u, x = lerp(s0[0], tgt[0], f) + Math.sin(Math.PI * f) * bend * 0.3, y = lerp(s0[1], tgt[1], f) - Math.sin(Math.PI * f) * Math.abs(bend) * 0.4; pts.push([x, y]); }
    tbill(pts, frz ? 7 : 5);
  }
  // WALL ST cut in the frieze: stencil caps >= 150 px, in the stone's own black
  const cap = Math.min(170, (fr.y2 - fr.y1) * 0.8);
  if (pr > 0.5) { ko.fillStyle = PAPER; ko.fillRect(fr.x1 + 20, fr.y1 + 2, fr.x2 - fr.x1 - 40, fr.y2 - fr.y1 - 4);
    const blk = setBlock(stencilF, [{ text: 'WALL ST', cap, max: cap, fill: true, sx: 1.25 }], { role: 'plant', x: tgt[0], y: (fr.y1 + fr.y2) / 2, maxW: fr.x2 - fr.x1 - 90 });
    kk.save(); kk.fillStyle = ink(BLK, 1); for (const G of blk.glyphs) { kk.save(); kk.translate(G.ox, G.oy); kk.fill(G.path); kk.restore(); }
    kk.globalCompositeOperation = 'destination-out'; kk.fillStyle = '#000';   // the stencil bridges, cut across each letter
    for (const G of blk.glyphs) kk.fillRect(G.ox + G.bb.x1 - 2, blk.bbox.y1 + cap * 0.47, G.bb.x2 - G.bb.x1 + 4, 7);
    kk.restore(); }
  const [cx, cy] = tgt, rr = 30 + 10 * Math.sin(tt * 6);
  over(() => { const g = tn.createRadialGradient(cx, cy, 0, cx, cy, 380); g.addColorStop(0, T(GOLD, 1)); g.addColorStop(1, T(GOLD, 0)); tn.fillStyle = g; tn.fillRect(cx - 380, cy - 380, 760, 760); });
  // the crowd of the exchange floor is not shown; the steps are empty. The guard duty paid this.
  const shake = frz ? 1.5 + 9 * clamp((b - 30) / 1.5) ** 2 : 0;
  return { cell: 9, misreg: frz ? 1.6 + 7 * Math.exp(-(b - 30) * 8) : 1.6 + 8 * Math.exp(-age * 7), shake, freeze: frz, flash: age < 0.066 || (b >= 30 && b < 30.07) ? 0.3 : 0 };
}
// 32-34 GUARD DUTY'S OVER.: the drop impact. A white flash frame; the garrison ink drains west across the sheet
// like the Capra map run backwards; the roundels pop in a wave out from the German cluster and leave as gold; the
// NATO seals crack; the press slams ~12 px off register.
function shotBye(b, t) {
  const u = (b - 32) / 2, r = lerp(2600, 1700, ease.outCubic(u)) * (1 + 0.12 * Math.exp(-(b - 32) * 6));
  const P = ortho(lerp(9, -2, u), lerp(49, 50, u), r, 540, 860, -4);
  globe(P, { land: LAND50, sea: 0.6, beat: b, borders: 1, grat: 0.7 });
  const drain = ease.inCubic(clamp((b - 32.05) / 1.5)), EU0 = EUR.concat(flags.filter(f => f.reg === 'EU'));
  for (const x of EU0) {
    if (!facing(P, x.lo, x.la)) continue;
    const k = 1.1 * (1 - drain * 0.85), [ix, iy] = P(x.route(0.06 * drain));
    const rr = k * (10 + 26 * Math.sqrt(4)); if (rr < 2) continue;
    const g = tn.createRadialGradient(ix, iy, rr * 0.2, ix - 30 * drain, iy, rr); g.addColorStop(0, T(BLK, 0.42)); g.addColorStop(1, T(BLK, 0));
    tn.fillStyle = g; tn.fillRect(ix - rr * 1.3, iy - rr, rr * 2.6, rr * 2);
  }
  for (const x of EU0) {
    if (!facing(P, x.lo, x.la)) continue;
    const [px, py] = P([x.lo, x.la]);
    if (b < x.dep || x.flag) { basePin(px, py, 11, x.flag ? 1 : 0); continue; }
    const a = b - x.dep, pop = a < 0.12 ? lerp(11, 19, a / 0.12) : 19 * Math.max(0, 1 - (a - 0.12) / 0.25);
    basePin(px, py, pop, 1);
    if (a < 0.5) { ko.lineWidth = 5; ko.beginPath(); ko.arc(px, py, 14 + a * 90, 0, TAU); ko.stroke(); kk.strokeStyle = ink(BLK, 1 - a * 2); kk.lineWidth = 2; kk.beginPath(); kk.arc(px, py, 17 + a * 90, 0, TAU); kk.stroke(); }
    const uu = clamp(a / 1.8); const hd = arcOnGlobe(P, x.route, Math.max(0, uu * 0.35 - 0.12), uu * 0.35, 0.1, 3.4, 12); if (hd) basePin(hd[0], hd[1], 5, 1);
  }
  const SEALS = ['RAMSTEIN', 'AVIANO', 'NAPLES', 'LAKENHEATH', 'ROTA', 'INCIRLIK'];
  SEALS.forEach((n, i) => { const x = bases.find(q => q.name === n); if (!x || !facing(P, x.lo, x.la)) return; const [px, py] = P([x.lo, x.la]);
    seal(px, py - 80, 58, clamp((b - 32.05 - i * 0.06) / 0.9)); });
  legend(b, bases.filter(x => b < x.land).length);
  return { cell: 9, misreg: 1.6 + 11 * Math.exp(-(b - 32) * 4), flash: b < 32.066 ? 1 : b < 32.14 ? 0.35 : 0 };
}
// 34-36 WE'RE COMING HOME.: the Minard band. Every departure joins one gold band whose width is the number of
// bases in it; it fattens as the garrison of Europe pours into it and runs west across the Atlantic.
function band(P, route, u0, u1, w0, w1, lift = 0.12, n = 40, lin = null) {
  const [cx, cy] = P.translate(), r = P.scale(), pts = [];
  for (let i = 0; i <= n; i++) { const u = lerp(u0, u1, i / n), q = lin ? lin(u) : null, ll = route(u);
    if (!lin && !facing(P, ...ll)) { pts.push(null); continue; }
    let [x, y] = lin ? q : P(ll); const h = Math.sin(Math.PI * u) * Math.min(lift * r, 110), dx = x - cx, dy = y - cy, dn = Math.hypot(dx, dy) || 1;
    if (!lin) { x += dx / dn * h; y += dy / dn * h; } pts.push([x, y, lerp(w0, w1, i / n)]); }
  const seg = (c, add, col) => { c.strokeStyle = col; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b2 = pts[i + 1]; if (!a || !b2) continue; c.lineWidth = b2[2] + add; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b2[0], b2[1]); c.stroke(); } };
  seg(kk, 5, ink(BLK, 1)); kk.save(); kk.globalCompositeOperation = 'destination-out'; seg(kk, 0.5, '#000'); kk.restore();
  seg(ko, 1.5, PAPER); seg(sp, 0, ink(GOLD, 1));
  // the flow lines inside the band: thin press-black threads running with it
  kk.lineWidth = 1; kk.strokeStyle = ink(BLK, 0.55);
  for (const f of [-0.25, 0.05, 0.3]) { kk.beginPath(); let on = false; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b2 = pts[i + 1]; if (!a || !b2) { on = false; continue; } const nx = -(b2[1] - a[1]), ny = b2[0] - a[0], nl = Math.hypot(nx, ny) || 1, o = f * a[2];
    on ? kk.lineTo(a[0] + nx / nl * o, a[1] + ny / nl * o) : kk.moveTo(a[0] + nx / nl * o, a[1] + ny / nl * o); on = true; } kk.stroke(); }
  return pts.filter(Boolean).at(-1);
}
const TRUNK = geoInterpolate([6, 48.5], [-77, 39.5]);
function shotHomeward(b, t) {
  const u = (b - 34) / 2, P = ortho(lerp(-30, -62, ease.inOutCubic(u)), lerp(42, 40, u), lerp(620, 700, u) * (1 + 0.05 * Math.exp(-(b - 34) * 5)), 540, 1250);
  globe(P, { land: LAND110, sea: 0.66, beat: b, grat: 0.8 });
  const gone = bases.filter(x => x.reg === 'EU' && b >= x.dep).length / EUR.length, head = ease.outCubic(clamp((b - 33.6) / 2.1));
  band(P, TRUNK, 0, head, 4, 8 + 44 * gone, 0.14, 48);
  for (const x of bases) if (b < x.dep && facing(P, x.lo, x.la)) { const [px, py] = P([x.lo, x.la]); basePin(px, py, 5); }
  for (const x of bases) if (b >= x.land && facing(P, x.home.lo, x.home.la)) { const [hx, hy] = P([x.home.lo, x.home.la]); homeLight(hx, hy, b - x.land, 1); }
  legend(b, bases.filter(x => b < x.land).length);
  return { cell: 9, misreg: 1.6 + 4 * Math.exp(-(b - 34) * 6) };
}
function homeLight(x, y, age, k = 1) {
  const s = k * (3 + 3 * Math.exp(-age * 3));
  ko.beginPath(); ko.arc(x, y, s + 2, 0, TAU); ko.fill(); sp.fillStyle = ink(GOLD, 1); sp.beginPath(); sp.arc(x, y, s, 0, TAU); sp.fill();
  if (age < 0.8) { const rr = s + age * 40; sp.strokeStyle = ink(GOLD, 1 - age / 0.8); sp.lineWidth = 2; sp.beginPath(); sp.arc(x, y, rr, 0, TAU); sp.stroke(); }
}
// 36-44 the litany: base word -> the base on its own map; TO ___. -> the journey on the real US map
function shotPairs(b, t) {
  const i = Math.floor((b - 36) / 2), f = flags[i], toWord = (b - 36) % 2 >= 1, age = (b - 36) % 1;
  return toWord ? shotJourney(b, t, f, age) : shotBase(b, t, f, age);
}
function shotBase(b, t, f, age) {
  const r = (f.reg === 'EU' ? 5200 : f.name === 'KADENA' ? 30000 : 13000) * (1 + 0.18 * Math.exp(-age * 7)) * (1 + age * 0.08);
  // look back along the route home: the base sits right of centre, home lies off the left edge
  const P = ortho(f.lo - (f.name === 'KADENA' ? -0.35 : f.name === 'NSA BAHRAIN' ? -0.6 : 2.5), f.la + (f.name === 'KADENA' ? 0.25 : 0.8), r, 540, 1080, 0);
  globe(P, { land: LANDC, sea: 0.62, beat: b, borders: 1, grat: 0.9 });
  for (const x of bases) if (Math.abs(x.la - f.la) < 12 && Math.abs(x.lo - f.lo) < 16 && x !== f && facing(P, x.lo, x.la)) {
    const [px, py] = P([x.lo, x.la]); if (b < x.dep) basePin(px, py, 7); }
  const [px, py] = P([f.lo, f.la]);
  basePin(px, py, 16, 1);
  kk.lineWidth = 3; kk.beginPath(); kk.arc(px, py, 30, 0, TAU); kk.stroke();
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; kk.beginPath(); kk.moveTo(px + 22 * Math.cos(a), py + 22 * Math.sin(a)); kk.lineTo(px + 44 * Math.cos(a), py + 44 * Math.sin(a)); kk.stroke(); }
  if (f.nato) seal(px, py - 110, 52, clamp((age - 0.35) / 0.55));
  const lift = clamp((age - 0.25) / 0.75);
  if (lift > 0) arcOnGlobe(P, f.route, 0, lift * 0.06, 0.02, 6, 16);
  // the pin's name plate, hand-set
  const ly = py + 92; ko.fillRect(px - 250, ly - 34, 500, 76);
  kk.lineWidth = 2; kk.strokeRect(px - 250, ly - 34, 500, 76);
  kk.fillStyle = ink(BLK, 1); kk.textAlign = 'center'; kk.font = '700 30px "Oswald"'; kk.fillText(f.full, px, ly);
  kk.font = '600 17px "Plex Mono"'; kk.fillText(`${f.where} · ${Math.abs(f.la).toFixed(2)}°${f.la > 0 ? 'N' : 'S'} ${Math.abs(f.lo).toFixed(2)}°E`, px, ly + 28);
  inset(b, f, lift * 0.2);
  arrivals(b, f);
  legend(b, bases.filter(x => b < x.land).length);
  return { cell: 9, misreg: 1.6 + 6 * Math.exp(-age * 8) };
}
// the arrivals board (v9, Solari): each pair after Aviano is a split-flap row over the map. The base's name clacks in
// as the arc lifts (b g), then TO + the home town clacks in letter by letter onto the landing (b g+0.75 -> g+1.2):
// the words are the board, not a caption.
const BOARD = { 38: ['RAMSTEIN', 'TO RICHMOND'], 40: ['BAHRAIN', 'TO BUFFALO'], 42: ['OKINAWA', 'TO OKLAHOMA'] };
const FLAPS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function flapRow(text, x0, y, t0, b, tw = 76, th = 106) {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], x = x0 + i * (tw + 5), set = t0 + i * 0.045 + 0.12;
    tn.fillStyle = T(BLK, 0.95); tn.fillRect(x, y, tw, th);
    kk.fillStyle = ink(BLK, 1); kk.fillRect(x, y, tw, th);
    let c = ' '; if (b >= set) c = ch; else if (b >= t0 + i * 0.045 && ch !== ' ') c = FLAPS[Math.floor((b * 97 + i * 7) % 26)];
    const flipping = b < set && b >= t0 + i * 0.045 && ch !== ' ';
    if (c !== ' ') { kk.save(); kk.globalCompositeOperation = 'destination-out'; kk.font = '700 88px "Oswald"'; kk.textAlign = 'center'; kk.fillStyle = '#000'; kk.fillText(c, x + tw / 2, y + th * 0.8); kk.restore();
      ko.save(); ko.font = '700 88px "Oswald"'; ko.textAlign = 'center'; ko.fillStyle = PAPER; ko.fillText(c, x + tw / 2, y + th * 0.8); ko.restore(); }
    if (flipping) { kk.fillStyle = ink(BLK, 0.85); kk.fillRect(x, y, tw, th * 0.5); }        // the falling top flap
    kk.save(); kk.globalCompositeOperation = 'destination-out'; kk.fillStyle = '#000'; kk.fillRect(x, y + th / 2 - 1.5, tw, 3); kk.restore();   // the hinge
    ko.fillRect(x, y + th / 2 - 1.5, tw, 3);
  }
}
function arrivals(b, f) {
  const rows = BOARD[f.g]; if (!rows) return;
  const tw = 76, n = Math.max(...rows.map(r => r.length)), x0 = 540 - (n * (tw + 5)) / 2, y0 = 300;
  ko.fillRect(x0 - 26, y0 - 26, n * (tw + 5) + 47, 2 * 106 + 16 + 52);
  tn.fillStyle = T(BLK, 0.8); tn.fillRect(x0 - 20, y0 - 20, n * (tw + 5) + 35, 2 * 106 + 16 + 40);
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 4; kk.strokeRect(x0 - 20, y0 - 20, n * (tw + 5) + 35, 2 * 106 + 16 + 40);
  flapRow(rows[0], x0, y0, f.g, b); flapRow(rows[1], x0, y0 + 122, f.g + 0.75, b);
}
// the locator inset: a small globe with the whole journey on it
function inset(b, f, u) {
  const cx = 860, cy = 1520, r = 120, mid = f.route(0.5), P = ortho(mid[0], mid[1], r, cx, cy);
  ko.beginPath(); ko.arc(cx, cy, r + 14, 0, TAU); ko.fill();
  tn.fillStyle = T(BLK, 0.5); tn.beginPath(); tn.arc(cx, cy, r, 0, TAU); tn.fill();
  const LP = P2(P, LAND110); over(() => { tn.fillStyle = '#fff'; tn.fill(LP); }); tn.fillStyle = T(BLK, 0.22); tn.fill(LP); over(() => { tn.fillStyle = T(RED, 1); tn.fill(P2(P, US48)); });
  kk.lineWidth = 1; kk.strokeStyle = ink(BLK, 1); kk.stroke(LP); kk.lineWidth = 2.5; kk.beginPath(); kk.arc(cx, cy, r, 0, TAU); kk.stroke(); kk.lineWidth = 1; kk.beginPath(); kk.arc(cx, cy, r + 10, 0, TAU); kk.stroke();
  sp.strokeStyle = ink(GOLD, 0.8); sp.lineWidth = 0.8; sp.stroke(P2(P, GRAT));
  if (u > 0) arcOnGlobe(P, f.route, 0, u, 0.12, 3, 30);
  const [ax, ay] = P([f.lo, f.la]); basePin(ax, ay, 5, 1);
  const [hx, hy] = P([f.home.lo, f.home.la]); if (u >= 1) homeLight(hx, hy, 1, 1.4); else basePin(hx, hy, 4);
  kk.font = '600 15px "Plex Mono"'; kk.textAlign = 'center'; kk.fillStyle = ink(BLK, 1); kk.fillText(`${f.miles.toLocaleString('en-US')} MI`, cx, cy + r + 34);
}
const JOURNEY_VIEW = { AKRON: [-82.5, 40.4, 3000], RICHMOND: [-99, 39.5, 1450], BUFFALO: [-79.5, 41.2, 3000], 'OKLAHOMA CITY': [-104, 37.5, 1800] };
function shotJourney(b, t, f, age) {
  const key = f.home.name.toUpperCase(), [vl, va, vs] = JOURNEY_VIEW[key];
  const A = albers(vl, va, vs * (1 + 0.16 * Math.exp(-age * 7)) * (1 + age * 0.05), 540, 1080);
  const land = clamp((b - (f.g + 1)) / 0.3), st = ease.outCubic(clamp((b - f.land) / 0.25));
  usMapBase(A, { state: f.state, stateA: st * 0.95, night: 0.1 });
  // towns already home stay lit
  for (const x of bases) if (b >= x.land && x !== f) { const [hx, hy] = A([x.home.lo, x.home.la]); if (hx > -10 && hx < W + 10 && hy > -10 && hy < H + 10) homeLight(hx, hy, b - x.land, 0.8); }
  // the journey: the great circle from the base, drawn onto the real map, cased, with mile ticks
  const head = lerp(0.55, 1, ease.outCubic(land)), pts = [];
  for (let k = 0; k <= 80; k++) { const u = lerp(0.55, head, k / 80); const [x, y] = A(f.route(u)); pts.push([x, y - Math.sin(Math.PI * (u - 0.55) / 0.45) * 60]); }
  cased(pts, 7, 5);
  kk.setLineDash([2, 18]); strokeRun(kk, pts, 3.5, ink(BLK, 1)); kk.setLineDash([]);
  const [cx, cy] = A([f.home.lo, f.home.la]);
  if (b >= f.land) {
    const a2 = b - f.land; homeLight(cx, cy, a2, 2.6);
    kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 2.5; for (let k = 0; k < 12; k++) { const a = k * TAU / 12, r1 = 22 + a2 * 30, r2 = r1 + 18; kk.beginPath(); kk.moveTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)); kk.lineTo(cx + r2 * Math.cos(a), cy + r2 * Math.sin(a)); kk.stroke(); }
    const lx = clamp(cx, 230, W - 230), ly = cy + 70; if (!BOARD[f.g]) { ko.fillRect(lx - 210, ly - 36, 420, 80); kk.lineWidth = 2.5; kk.strokeRect(lx - 210, ly - 36, 420, 80);
    kk.fillStyle = ink(BLK, 1); kk.textAlign = 'center'; kk.font = '700 36px "Oswald"'; kk.fillText(`${key}, ${f.state.toUpperCase()}`, lx, ly + 4);
    kk.font = '600 17px "Plex Mono"'; kk.fillText(`FROM ${f.name} · ${f.miles.toLocaleString('en-US')} MI`, lx, ly + 30); }
  }
  inset(b, f, clamp(0.2 + 0.8 * land));
  arrivals(b, f);
  legend(b, bases.filter(x => b < x.land).length);
  return { cell: 9, misreg: 1.6 + 5 * Math.exp(-age * 8) };
}
// 44-46 ALL 750 HOME.: the Minard band lands. The Atlantic trunk and the Pacific trunk come in off the edges, split
// into the four named towns and fan out to every home town; all 750 light on the hit and the counter reads 0.
const FLOW_E = [-66, 39.5], FLOW_W = [-126, 38.5];
function shotHome(b, t) {
  const age = b - 44, A = albers(-96.5, 38.6, 1250 * (1 + 0.05 * Math.exp(-age * 5)) * (1 + age * 0.03), 540, 1000);
  usMapBase(A, { night: 0.25, labels: 0 });
  const fade = 1 - clamp((age - 0.6) / 1.2), lin = r0 => u => A(r0(u));
  if (fade > 0) {
    const east = homes => homes.filter(h => h.lo > -98), sE = A(FLOW_E), sW = A(FLOW_W);
    // capillaries to every home town (thin), then the four named branches (thick), then the trunks off the edges
    for (const x of bases) { if (bases.indexOf(x) % 2) continue; const src = x.home.lo > -98 ? FLOW_E : FLOW_W, rt = geoInterpolate(src, [x.home.lo, x.home.la]);
      band(A, rt, 0, 1, 2.2 * fade, 1.2 * fade, 0, 8, lin(rt)); }
    for (const f of flags) { const src = f.home.lo > -98 ? FLOW_E : FLOW_W, rt = geoInterpolate(src, [f.home.lo, f.home.la]); band(A, rt, 0, 1, 16 * fade, 9 * fade, 0, 24, lin(rt)); }
    band(A, u => [lerp(-50, FLOW_E[0], u), FLOW_E[1]], 0, 1, 60 * fade, 44 * fade, 0, 12, lin(u => [lerp(-50, FLOW_E[0], u), FLOW_E[1]]));
    band(A, u => [lerp(-150, FLOW_W[0], u), FLOW_W[1]], 0, 1, 30 * fade, 24 * fade, 0, 12, lin(u => [lerp(-150, FLOW_W[0], u), FLOW_W[1]]));
  }
  for (const x of bases) { const [hx, hy] = A([x.home.lo, x.home.la]); if (b >= x.land) homeLight(hx, hy, b - x.land, 1.1); }
  for (const f of flags) { const [hx, hy] = A([f.home.lo, f.home.la]); homeLight(hx, hy, b - f.land + 1, 2.2); }
  legend(b, bases.filter(x => b < x.land).length, ['U.S. INSTALLATIONS', 'ABROAD'], true);
  return { cell: 9, misreg: 1.6 + 6 * Math.exp(-age * 6), flash: age < 0.066 ? 0.5 : 0 };
}
// 47 THREE SHIFTS.: crash zoom into the Youngstown works, all three shifts lit
function shotMill(b, t) {
  const age = b - 46, z = 1 + 0.35 * Math.exp(-age * 6) + 0.2 * (b >= 47 ? ease.outExpo(clamp((b - 47) / 0.2)) : 0);   // v9: 46-48, the kick on the third lamp
  const hy = 1180;
  skyTone(ink(BLK, 0.9), ink(RED, 0.8), hy, 820, 1000, 0.25);
  tn.fillStyle = T(BLK, 0.85); tn.fillRect(0, hy, W, H - hy);
  const s = 1.25 * z, ox = 540 - 540 * s, oy = hy - hy * s;
  const X = x => ox + x * s, Y = y => oy + y * s;
  // furnace, stoves, stacks, the long sheds
  tn.fillStyle = T(BLK, 0.78);
  const furnace = new Path2D(); furnace.moveTo(X(120), Y(hy)); furnace.lineTo(X(150), Y(hy - 420)); furnace.lineTo(X(230), Y(hy - 420)); furnace.lineTo(X(260), Y(hy)); furnace.closePath(); tn.fill(furnace);
  for (let k = 0; k < 3; k++) { const x0 = 280 + k * 64; tn.beginPath(); tn.rect(X(x0), Y(hy - 330), 52 * s, 330 * s); tn.arc(X(x0 + 26), Y(hy - 330), 26 * s, Math.PI, 0); tn.fill();
    kk.lineWidth = 2; kk.strokeRect(X(x0), Y(hy - 330), 52 * s, 330 * s); kk.beginPath(); kk.arc(X(x0 + 26), Y(hy - 330), 26 * s, Math.PI, 0); kk.stroke();
    for (let yy = hy - 310; yy < hy; yy += 26) { kk.lineWidth = 0.8; kk.beginPath(); kk.moveTo(X(x0), Y(yy)); kk.lineTo(X(x0 + 52), Y(yy)); kk.stroke(); } }
  kk.lineWidth = 2.5; kk.stroke(furnace); hatchPath(kk, furnace, 1.2, 7, 1, ink(BLK, 0.8));
  kk.lineWidth = 4; kk.beginPath(); kk.moveTo(X(190), Y(hy - 420)); kk.lineTo(X(190), Y(hy - 520)); kk.lineTo(X(470), Y(hy - 520)); kk.stroke();
  for (let k = 0; k < 14; k++) { kk.lineWidth = 1.5; kk.beginPath(); kk.moveTo(X(40 + k * 10), Y(hy - k * 30)); kk.lineTo(X(50 + k * 10), Y(hy - k * 30 - 30)); kk.stroke(); }
  kk.lineWidth = 3; kk.beginPath(); kk.moveTo(X(40), Y(hy)); kk.lineTo(X(180), Y(hy - 420)); kk.moveTo(X(70), Y(hy)); kk.lineTo(X(200), Y(hy - 400)); kk.stroke();
  for (let k = 0; k < 4; k++) { const x0 = 500 + k * 62; tn.fillStyle = T(BLK, 0.8); tn.fillRect(X(x0), Y(hy - 560 + k * 20), 24 * s, (560 - k * 20) * s); kk.lineWidth = 2; kk.strokeRect(X(x0), Y(hy - 560 + k * 20), 24 * s, (560 - k * 20) * s);
    for (let j = 0; j < 7; j++) { const q = (t * 0.45 + j / 7 + k * 0.21) % 1, px = X(x0 + 12 + q * 260), py = Y(hy - 580 + k * 20 - q * 520), rr = (26 + q * 120) * s;
      over(() => { const gg = tn.createRadialGradient(px, py, 0, px, py, rr); gg.addColorStop(0, T(PAPER, 0.8 * (1 - q))); gg.addColorStop(1, T(PAPER, 0)); tn.fillStyle = gg; tn.fillRect(px - rr, py - rr, rr * 2, rr * 2); });
      tn.fillStyle = T(RED, 0.4 * (1 - q)); tn.beginPath(); tn.arc(px, py + rr * 0.35, rr * 0.7, 0, TAU); tn.fill(); } }
  const shx = 420, shw = 900, shh = 260;
  tn.fillStyle = T(BLK, 0.7); tn.fillRect(X(shx), Y(hy - shh), shw * s, shh * s);
  kk.lineWidth = 2.5; kk.beginPath(); for (let k = 0; k < 14; k++) { const x0 = shx + k * 64; kk.moveTo(X(x0), Y(hy - shh)); kk.lineTo(X(x0 + 64), Y(hy - shh - 50)); kk.lineTo(X(x0 + 64), Y(hy - shh)); } kk.stroke();
  kk.strokeRect(X(shx), Y(hy - shh), shw * s, shh * s);
  const SH = [['7 – 3', 0], ['3 – 11', 0.5], ['11 – 7', 1.0]];   // one shift per 8th note: b46, b46.5, b47
  SH.forEach(([lab, d], row) => {
    const on = age >= d, yy = hy - shh + 40 + row * 72;
    for (let k = 0; k < 20; k++) { const x0 = shx + 20 + k * 44;
      if (on) { const fl = 0.85 + 0.15 * Math.sin(t * 9 + k * 1.3 + row); ko.fillRect(X(x0), Y(yy), 30 * s, 40 * s); sp.fillStyle = ink(GOLD, fl); sp.fillRect(X(x0), Y(yy), 30 * s, 40 * s);
        over(() => { tn.fillStyle = T(GOLD, 0.35); tn.fillRect(X(x0) - 10, Y(yy) - 10, 30 * s + 20, 40 * s + 20); }); }
      kk.lineWidth = 1.5; kk.strokeRect(X(x0), Y(yy), 30 * s, 40 * s); kk.beginPath(); kk.moveTo(X(x0 + 15), Y(yy)); kk.lineTo(X(x0 + 15), Y(yy + 40)); kk.stroke(); }
    if (on) { const lx = X(shx + 20 + 20 * 44 - 4); ko.fillRect(lx - 4, Y(yy) - 2, 120, 40 * s); kk.font = `700 ${Math.round(30 * s)}px "Oswald"`; kk.textAlign = 'left'; kk.fillStyle = ink(BLK, 1); kk.fillText(lab, lx, Y(yy + 32)); }
  });
  // the cast house glow and the ladle's light on the yard
  over(() => { const gg = tn.createRadialGradient(X(200), Y(hy), 0, X(200), Y(hy), 380 * s); gg.addColorStop(0, T(GOLD, 0.9)); gg.addColorStop(0.4, T(RED, 0.6)); gg.addColorStop(1, T(RED, 0)); tn.fillStyle = gg; tn.fillRect(0, Y(hy - 400), W, 800 * s); });
  kk.lineWidth = 2; for (let k = 0; k < 16; k++) { const y = hy + 30 + k * k * 4; kk.beginPath(); kk.moveTo(0, y); kk.lineTo(W, y + 8); kk.stroke(); }
  // the gate's shift board, in front of the works: one lamp per shift, lit on the 8ths
  { const bx = 70, by = 1330, bw = 470, bh = 470; tn.fillStyle = T(BLK, 0.9); tn.fillRect(bx, by, bw, bh);
    kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 5; kk.strokeRect(bx, by, bw, bh); kk.fillStyle = ink(BLK, 1); kk.fillRect(bx + bw / 2 - 12, by + bh, 24, 200);
    ['1ST', '2ND', '3RD'].forEach((lab, k) => { const on = age >= k * 0.5, ly = by + 90 + k * 145, lx = bx + 90, a = on ? 0.9 + 0.1 * Math.sin(t * 20 + k) : 0;
      ko.beginPath(); ko.arc(lx, ly, 52, 0, TAU); ko.fill(); sp.fillStyle = on ? ink(GOLD, a) : ink(BLK, 0.0); sp.beginPath(); sp.arc(lx, ly, 46, 0, TAU); sp.fill();
      if (!on) { tn.fillStyle = T(BLK, 0.7); tn.beginPath(); tn.arc(lx, ly, 46, 0, TAU); tn.fill(); }
      else over(() => { const g = tn.createRadialGradient(lx, ly, 0, lx, ly, 160); g.addColorStop(0, T(PAPER, 0.9)); g.addColorStop(1, T(PAPER, 0)); tn.fillStyle = g; tn.fillRect(lx - 160, ly - 160, 320, 320); });
      kk.lineWidth = 4; kk.beginPath(); kk.arc(lx, ly, 50, 0, TAU); kk.stroke();
      ko.save(); ko.font = '700 96px "Oswald"'; ko.textAlign = 'left'; ko.fillStyle = PAPER; ko.globalAlpha = on ? 1 : 0.45; ko.fillText(lab, lx + 90, ly + 34); ko.restore();
      kk.save(); kk.globalCompositeOperation = 'destination-out'; kk.font = '700 96px "Oswald"'; kk.textAlign = 'left'; kk.fillText(lab, lx + 90, ly + 34); kk.restore(); }); }
  motes(47, 60, t, 30, -120, 0.9);
  return { cell: 9, misreg: 1.6 + 8 * Math.exp(-age * 7) };
}
// 48-50 EVERY SOLDIER BUILDS.: one soldier in profile, a pure silhouette against the troop deck's red lamp. On the
// half beat the steel pot lifts off his head; on b49 (flash) it comes down as the PUBLIC WORKS hard hat and the lamp
// becomes the dawn over a steel frame. His back is to the light: no face, only the edge of the profile, rim-lit.
function profileHead() {   // head, neck and shoulders facing right, in frame units
  const p = new Path2D();
  p.moveTo(300, 1580); p.bezierCurveTo(330, 1450, 370, 1330, 372, 1240); p.bezierCurveTo(372, 1160, 330, 1080, 338, 980);
  p.bezierCurveTo(345, 860, 430, 770, 540, 762); p.bezierCurveTo(640, 758, 700, 820, 712, 900);
  p.bezierCurveTo(716, 935, 706, 952, 712, 968); p.lineTo(760, 1046); p.bezierCurveTo(766, 1058, 752, 1066, 730, 1070);
  p.lineTo(734, 1096); p.bezierCurveTo(738, 1106, 726, 1112, 722, 1118); p.bezierCurveTo(734, 1128, 732, 1146, 724, 1156);
  p.bezierCurveTo(716, 1196, 690, 1206, 646, 1210); p.bezierCurveTo(630, 1240, 640, 1290, 660, 1330);
  p.bezierCurveTo(680, 1400, 760, 1480, 900, 1560); p.bezierCurveTo(1010, 1610, 1080, 1680, 1100, 1960);
  p.lineTo(-20, 1960); p.bezierCurveTo(-10, 1760, 120, 1640, 300, 1580); p.closePath();
  return p;
}
const PROFILE = profileHead();
function helmetProfile(m) {   // m 0 = the M1 (low dome, flared rim, the neck guard behind), 1 = the hard hat (tall shell, ridge, front peak)
  const p = new Path2D();
  const back = [lerp(300, 318, m), lerp(1000, 968, m)], front = [lerp(752, 800, m), lerp(918, 930, m)];
  p.moveTo(...back); p.bezierCurveTo(lerp(300, 318, m), lerp(760, 690, m), lerp(470, 430, m), lerp(640, 600, m), lerp(560, 560, m), lerp(645, 600, m));
  p.bezierCurveTo(lerp(700, 690, m), lerp(650, 620, m), lerp(750, 740, m), lerp(800, 780, m), lerp(740, 732, m), lerp(900, 896, m));
  p.lineTo(...front); p.lineTo(front[0] - 6, front[1] + 16);
  p.bezierCurveTo(600, lerp(935, 915, m), 420, lerp(975, 955, m), back[0] - lerp(20, 8, m), back[1] + lerp(20, 10, m)); p.closePath();
  return p;
}
function shotHelmet(b, t) {
  const age = b - 48, m = ease.inOutCubic(clamp((b - 49) / 0.18));
  const lift = b < 49 ? ease.inCubic(clamp((b - 48.45) / 0.55)) : 1 - ease.outBack(clamp((b - 49) / 0.3));
  const z = 1 + 0.06 * Math.exp(-age * 6) + age * 0.015;
  if (m < 0.5) {   // the troop deck: bunk rails in hatching, the red lamp behind his head
    tn.fillStyle = T(BLK, 0.8); tn.fillRect(0, 0, W, H);
    over(() => { const rl = tn.createRadialGradient(560, 1230, 0, 560, 1230, 820); rl.addColorStop(0, T(PAPER, 0.95)); rl.addColorStop(0.28, T(RED, 0.95)); rl.addColorStop(1, T(RED, 0)); tn.fillStyle = rl; tn.fillRect(0, 0, W, H); });
    kk.strokeStyle = ink(BLK, 0.7); for (let k = 0; k < 9; k++) { const y = 260 + k * 170; kk.lineWidth = 3; kk.beginPath(); kk.moveTo(0, y); kk.lineTo(W, y + 30); kk.stroke(); }
    hatchRect(kk, 0, 0, W, H, 0.9, 13, 1, ink(BLK, 0.35));
  } else {         // the site at dawn: a gold sky, the steel frame rising behind him
    skyTone(ink(GOLD, 0.35), ink(GOLD, 0.8), H, 640, 880, 1);
    const P = cam3([0, 20, -120], [0, 60, 0], 70);
    for (let i = -3; i <= 3; i++) for (let lv = 0; lv < 9; lv++) { seg3(kk, P, [i * 16, lv * 12, 40], [i * 16, lv * 12 + 12, 40], 0.9); seg3(kk, P, [i * 16, lv * 12, 40], [(i + 1) * 16, lv * 12, 40], 0.6); seg3(kk, P, [i * 16, lv * 12, 40], [i * 16 + 16, lv * 12 + 12, 40], 0.25); }
  }
  kk.save(); kk.translate(540, 1920); kk.scale(z, z); kk.translate(-540, -1920 + 330);
  ko.save(); ko.translate(540, 1920); ko.scale(z, z); ko.translate(-540, -1920 + 330);
  sp.save(); sp.translate(540, 1920); sp.scale(z, z); sp.translate(-540, -1920 + 330);
  // the helmet: tips up off the back of the head (pivot at the rear rim) and comes down transformed
  const hp = helmetProfile(m), piv = [310, 1000], ang = -0.55 * lift, dy = -260 * lift;
  const H2 = new Path2D(); H2.addPath(hp, new DOMMatrix().translateSelf(piv[0], piv[1] + dy).rotateSelf(ang * 57.3).translateSelf(-piv[0], -piv[1]));
  rimmed([PROFILE, H2], 7, -5, 7, 1);
  if (m >= 0.5) {   // the hard hat's ridge and its stencilled band, cut to paper in the black shell
    kk.save(); kk.globalCompositeOperation = 'destination-out'; kk.fillStyle = '#000';
    const tx = new DOMMatrix().translateSelf(piv[0], piv[1] + dy).rotateSelf(ang * 57.3).translateSelf(-piv[0], -piv[1]);
    kk.setTransform(kk.getTransform().multiply(tx)); kk.font = '700 50px "Oswald"'; kk.textAlign = 'center'; kk.fillText('PUBLIC WORKS', 530, 860);
    kk.fillRect(420, 870, 250, 5); kk.restore();
  }
  kk.restore(); ko.restore(); sp.restore();
  motes(48, 36, t, 20, -40, 0.8);
  return { cell: 9, misreg: 1.6 + 6 * Math.exp(-(b - Math.floor(b)) * 8), flash: b >= 49 && b < 49.07 ? 0.7 : 0 };
}
// a SIL figure printed like the rest of the sheet: the body solid in the key, a gold rim toward the light (dx, dy),
// a contact shadow in the tone plate under the boots. pose: a SIL pose name; walkers step through walk0-7.
function silFig(type, pose, x, y, h, { flip = false, rim = [0, -4], shadow = 1 } = {}) {
  const c = SIL.cell(type, pose); if (!c) return;
  if (shadow) { tn.fillStyle = T(BLK, 0.55 * shadow); tn.beginPath(); tn.ellipse(x, y, h * 0.13, h * 0.022, 0, 0, TAU); tn.fill(); }
  SIL.blit(ko, c, x + rim[0], y + rim[1], h, { flip, color: PAPER });
  SIL.blit(sp, c, x + rim[0], y + rim[1], h, { flip, color: ink(GOLD, 1) });
  for (const g of [sp, ko]) { g.save(); g.globalCompositeOperation = 'destination-out'; SIL.blit(g, c, x, y, h, { flip, color: '#000' }); g.restore(); }
  SIL.blit(kk, c, x, y, h, { flip, color: BLK });
}
const HARD = [0, 1, 2, 3, 4, 5];
// a crew in ranks (near, mid, far): [x, footY, h, pose, flip] per figure; walkers ('walk') step on the song's 8ths
function crew2(list, t, seed = 1) {
  const r = rng(seed);
  list.sort((a, b) => a[1] - b[1]).forEach(([x, y, h, pose, flip], i) => {
    const ty = HARD[Math.floor(r() * HARD.length)], ps = pose === 'walk' ? 'walk' + (Math.floor(t * 4 + i * 3) % 8) : pose;
    silFig(ty, ps, x, y, h, { flip: !!flip, rim: [0, -Math.max(2, h * 0.012)] });
  });
}
// 50-52 BRIDGES.: a cantilever span closes in time-lapse
function shotBridge(b, t) {
  const u = (b - 50) / 2, grow = lerp(0.35, 1, ease.inOutCubic(clamp(u / 0.92)));
  const P = cam3([-150 + 40 * u, 14 + 4 * u, -215], [20, 32, 0], 50);
  const hy = P([0, 0, 3000])[1];
  skyTone(ink(RED, lerp(0.9, 0.7, u)), ink(GOLD, 0.7), hy, lerp(250, 850, u), hy - 60, 0.7);
  clouds(9, 6, 200, hy - 150, t * 60, BLK, 0.14, 1.3);
  // far hills and the far bank's works
  tn.fillStyle = T(BLK, 0.32); tn.beginPath(); tn.moveTo(0, hy);
  for (let x = 0; x <= W; x += 20) tn.lineTo(x, hy - 40 - 40 * Math.sin(x * 0.006 + 1) - 20 * Math.sin(x * 0.021)); tn.lineTo(W, hy); tn.fill();
  // water with its bare-paper glints and the bridge's reflection
  tn.fillStyle = T(BLK, 0.62); tn.fillRect(0, hy, W, H - hy);
  const s = rng(12); over(() => { for (let i = 0; i < 140; i++) { const y = hy + Math.pow(s(), 1.6) * (H - hy), x = ((s() * W + t * 25 * (1 + (y - hy) / 300)) % W), w = 20 + (y - hy) * 0.25;
    tn.fillStyle = T(PAPER, 0.5); tn.fillRect(x, y, w, 1.5 + (y - hy) * 0.01); } });
  const PANEL = 12, piers = [-120, 120], topY = x => { const d = Math.min(...piers.map(p => Math.abs(x - p))); return 30 + 12 + 30 * Math.max(0, 1 - d / 110); };
  const built = x => { if (Math.abs(x) >= 120) return true; return 120 - Math.abs(x) <= 120 * grow; };
  // reflection (tone only)
  const R2 = cam3(P.eye.map((v, i) => i === 1 ? -v : v), [25, -34, 0], 52);
  tn.strokeStyle = T(BLK, 0.35); tn.lineWidth = 6;
  for (let x = -240; x < 240; x += PANEL) if (built(x) && built(x + PANEL)) for (const z of [-9, 9]) {
    for (const [a, c] of [[[x, 30, z], [x + PANEL, 30, z]], [[x, topY(x), z], [x + PANEL, topY(x + PANEL), z]], [[x, 30, z], [x + PANEL, topY(x + PANEL), z]]]) {
      const A1 = R2([a[0], -a[1], a[2]]), C1 = R2([c[0], -c[1], c[2]]); if (A1[2] < 1 || C1[2] < 1) continue; tn.beginPath(); tn.moveTo(A1[0], A1[1] + 6 * Math.sin(A1[0] * 0.1 + t * 3)); tn.lineTo(C1[0], C1[1]); tn.stroke(); } }
  // piers
  for (const px of piers) {
    const f1 = [[px - 8, 0, -12], [px + 8, 0, -12], [px + 6, 30, -12], [px - 6, 30, -12]], f2 = [[px + 8, 0, -12], [px + 8, 0, 12], [px + 6, 30, 12], [px + 6, 30, -12]];
    poly3(tn, P, f1, T(BLK, 0.5)); poly3(tn, P, f2, T(BLK, 0.75));
    for (const f of [f1, f2]) { kk.lineWidth = 2; kk.strokeStyle = ink(BLK, 1); kk.beginPath(); f.forEach((q, i) => { const [x, y] = P(q); i ? kk.lineTo(x, y) : kk.moveTo(x, y); }); kk.closePath(); kk.stroke(); }
    for (let yy = 3; yy < 30; yy += 3) seg3(kk, P, [px - 8 + yy * 0.066, yy, -12], [px + 8 - yy * 0.066, yy, -12], 0.08, BLK, 0.7);
  }
  // the trusses, member by member in erection order
  const trussCol = BLK;
  for (let x = -240; x < 240; x += PANEL) {
    if (!(built(x) && built(x + PANEL))) continue;
    const x1 = x + PANEL;
    for (const z of [-9, 9]) {
      seg3(kk, P, [x, 30, z], [x1, 30, z], 0.9, trussCol); seg3(kk, P, [x, topY(x), z], [x1, topY(x1), z], 0.8, trussCol);
      seg3(kk, P, [x, 30, z], [x, topY(x), z], 0.55, trussCol);
      const dg = ((x / PANEL) | 0) % 2 ? [[x, 30, z], [x1, topY(x1), z]] : [[x, topY(x), z], [x1, 30, z]]; seg3(kk, P, dg[0], dg[1], 0.45, trussCol);
    }
    seg3(kk, P, [x, topY(x), -9], [x, topY(x), 9], 0.35, trussCol); seg3(kk, P, [x, topY(x), -9], [x1, topY(x1), 9], 0.2, trussCol); seg3(kk, P, [x, 30, -9], [x, 30, 9], 0.4, trussCol);
    seg3(kk, P, [x, 30.5, -7], [x1, 30.5, -7], 0.3, trussCol); seg3(kk, P, [x, 30.5, 7], [x1, 30.5, 7], 0.3, trussCol);
  }
  // creeper cranes at the arm tips, and the sparks where they work
  const tip = 120 - 120 * grow;
  for (const sgn of [-1, 1]) if (grow < 0.995) {
    const tx = sgn * tip, top = [tx, topY(tx), 0];
    const mast = [tx, topY(tx) + 22, 0]; seg3(kk, P, top, mast, 0.5); const boomEnd = [tx - sgn * 26, topY(tx) + 10, 0]; seg3(kk, P, mast, boomEnd, 0.35); seg3(kk, P, mast, [tx + sgn * 10, topY(tx), 0], 0.2);
    const hook = [tx - sgn * 26, 30 - 8 + 4 * Math.sin(t * 2), 0]; seg3(kk, P, boomEnd, hook, 0.08);
    const [sx, sy] = P([tx, 30, 0]); for (let k = 0; k < 16; k++) { const a = (k * 2.4 + t * 13) % TAU, v = 30 + (k * 37 % 50), q = (t * 3 + k * 0.13) % 1;
      const x = sx + Math.cos(a) * v * q, y = sy + Math.sin(a) * v * q * 0.5 + 200 * q * q; ko.beginPath(); ko.arc(x, y, 3, 0, TAU); ko.fill(); sp.fillStyle = ink(GOLD, 1 - q); sp.beginPath(); sp.arc(x, y, 2.2, 0, TAU); sp.fill(); }
  }
  if (grow >= 0.995) { const [sx, sy] = P([0, 40, 0]), a = clamp((b - 51.84) / 0.3); sp.strokeStyle = ink(GOLD, 1 - a); sp.lineWidth = 5; sp.beginPath(); sp.arc(sx, sy, 20 + a * 200, 0, TAU); sp.stroke(); }
  // near bank: reeds in the foreground, fast parallax
  tn.fillStyle = T(BLK, 0.9); tn.beginPath(); tn.moveTo(0, H); tn.lineTo(0, 1620); tn.quadraticCurveTo(300, 1560 + 20 * u, 620, 1700); tn.lineTo(760, H); tn.fill();
  const rs = rng(4); kk.lineWidth = 3; for (let i = 0; i < 70; i++) { const x = rs() * 720 - u * 60, y = 1640 + rs() * 280, h = 80 + rs() * 200, lean = (rs() - 0.5) * 60 + 10 * Math.sin(t * 2 + i);
    kk.beginPath(); kk.moveTo(x, y); kk.quadraticCurveTo(x + lean * 0.3, y - h * 0.6, x + lean, y - h); kk.stroke(); }
  // the crews: riveters at the two arm tips (projected), and a gang on the near bank hauling the span's guy line
  { const crew = []; for (const sgn of [-1, 1]) if (grow < 0.995) { const tx = sgn * (120 - 120 * grow), q = P([tx - sgn * 4, topY(tx) + 0.2, 8]), hh = 2.2 * P.F / Math.max(1, P.depth([tx, 40, 8]));
      crew.push(workerPath(q[0], q[1], hh, hammerPose(t, sgn * 0.3), -sgn)); const q2 = P([tx - sgn * 10, 30.2, -8]); crew.push(workerPath(q2[0], q2[1], hh * 0.95, POSES.pry, -sgn)); }
    const lean = 0.03 * Math.sin(t * 3);
    rimmed(crew, 0, -4, 5, 1); }
  { crew2([[90, 1690, 330, 'heave', 1], [270, 1706, 340, 'heave', 1], [455, 1726, 320, 'shovel'], [620, 1760, 350, 'sledge', 1],
      [170, 1628, 190, 'walk'], [360, 1640, 185, 'standA'], [520, 1668, 190, 'shovel', 1],
      ...Array.from({ length: 12 }, (_, i) => [140 + i * 62 + (i % 3) * 9, hy - 44 + (i % 2) * 3, 16 + (i % 3) * 2, i % 4 ? 'walk' : 'standB', i % 2])], t, 50);
    kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 6; kk.beginPath(); kk.moveTo(-20, 1360); kk.quadraticCurveTo(300, 1450, 700, 1500); kk.stroke(); }
  motes(50, 45, t, 25, -15, 0.7);
  return { cell: 9, misreg: 1.6 };
}
// 52-54 RAILS.: the new line runs to the horizon; the trainset comes up it
function shotRails(b, t) {
  const u = (b - 52) / 2, P = cam3([-1.8, 2.3, -2 + 5 * u], [1.2, 1.6, 80], 62);
  const hy = P([0, 0, 5000])[1];
  skyTone(ink(RED, 0.8), ink(GOLD, 0.65), hy, 780, hy - 30, 0.8);
  clouds(19, 7, 200, hy - 100, t * 80, BLK, 0.13, 1.2);
  tn.fillStyle = T(BLK, 0.3); tn.beginPath(); tn.moveTo(0, hy); for (let x = 0; x <= W; x += 16) tn.lineTo(x, hy - 30 - 50 * Math.abs(Math.sin(x * 0.004 + 2)) - 12 * Math.sin(x * 0.03)); tn.lineTo(W, hy); tn.fill();
  // the plain: gold stubble in furrows running to the vanishing point
  tn.fillStyle = T(GOLD, 0.55); tn.fillRect(0, hy, W, H - hy); tn.fillStyle = T(RED, 0.2); tn.fillRect(0, hy, W, H - hy);
  for (let k = -40; k <= 40; k++) seg3(kk, P, [k * 6, 0, 3], [k * 6, 0, 2400], 0.05, BLK, 0.6);
  // ballast bed
  const z0 = P.eye[2] + 1.2;
  poly3(tn, P, [[-2.2, 0, z0], [2.2, 0, z0], [2.2, 0, 3000], [-2.2, 0, 3000]], T(BLK, 0.45));
  poly3(tn, P, [[2.4, 0, z0], [6.6, 0, z0], [6.6, 0, 3000], [2.4, 0, 3000]], T(BLK, 0.45));
  const lay = lerp(30, 1800, ease.inOutCubic(clamp(u * 1.15)));
  for (const [cxr, len] of [[0, lay], [4.5, 3000]]) {
    // v8: timber ties in tone (lighter, shorter) under two heavy converging steel rails, so it reads as track and never
    // as a staircase: the rails are the strongest line in the frame
    for (let z = Math.floor(P.eye[2]) + 1; z < Math.min(len, 400); z += 0.62) poly3(tn, P, [[cxr - 1.25, 0.05, z], [cxr + 1.25, 0.05, z], [cxr + 1.25, 0.05, z + 0.2], [cxr - 1.25, 0.05, z + 0.2]], T(BLK, 0.5));
    for (const rx of [-0.72, 0.72]) { seg3n(kk, P, [cxr + rx, 0.08, 0.8], [cxr + rx, 0.08, len], 0.2, BLK); seg3n(sp, P, [cxr + rx, 0.2, 0.8], [cxr + rx, 0.2, len], 0.05, GOLD); }
  }
  // the laying head: sparks and the gold running ahead
  const [lx, ly] = P([0, 0.3, lay]); if (lay < 1790) for (let k = 0; k < 18; k++) { const a = (k * 2.4 + t * 11) % TAU, q = (t * 2.5 + k * 0.17) % 1, x = lx + Math.cos(a) * 60 * q, y = ly - Math.abs(Math.sin(a)) * 40 * q + 30 * q * q;
    ko.beginPath(); ko.arc(x, y, 2.5, 0, TAU); ko.fill(); sp.fillStyle = ink(GOLD, 1 - q); sp.beginPath(); sp.arc(x, y, 2, 0, TAU); sp.fill(); }
  // catenary: masts and wires over both lines
  for (let z = 10; z < 1500; z += 50) { seg3(kk, P, [2.25, 0, z], [2.25, 7.2, z], 0.13); seg3(kk, P, [2.25, 6.6, z], [6.2, 6.6, z], 0.06); seg3(kk, P, [2.25, 6.6, z], [-1.2, 6.6, z], 0.06); }
  for (const x of [0, 4.5]) for (let z = 10; z < 1500; z += 50) { seg3(kk, P, [x, 5.6, z], [x, 5.6, z + 50], 0.02); seg3(kk, P, [x, 6.6, z], [x, 6.2, z + 25], 0.02); seg3(kk, P, [x, 6.2, z + 25], [x, 6.6, z + 50], 0.02); }
  // the trainset on the far line, head-on and closing
  const tz = lerp(520, 22, ease.inOutCubic(clamp(u * 1.08)));
  if (tz < 900) {
    const c = [4.5, 0, tz], bw = 1.7;
    const side = [[c[0] - bw, 0.6, tz + 2], [c[0] - bw, 3.4, tz + 2], [c[0] - bw, 3.4, tz + 220], [c[0] - bw, 0.6, tz + 220]];
    poly3(tn, P, side, T(PAPER, 0)); over(() => poly3(tn, P, side, T(PAPER, 1))); poly3(tn, P, side, T(GOLD, 0.25));
    const band = [[c[0] - bw, 2.2, tz + 3], [c[0] - bw, 2.8, tz + 3], [c[0] - bw, 2.8, tz + 220], [c[0] - bw, 2.2, tz + 220]]; poly3(tn, P, band, T(BLK, 0.85));
    const stripe = [[c[0] - bw, 1.1, tz + 3], [c[0] - bw, 1.5, tz + 3], [c[0] - bw, 1.5, tz + 220], [c[0] - bw, 1.1, tz + 220]]; poly3(tn, P, stripe, T(RED, 1));
    const nose = [];
    for (let i = 0; i <= 24; i++) { const a = Math.PI * i / 24; nose.push([c[0] - Math.cos(a) * bw, 0.6 + Math.sin(a) * 2.9, tz - Math.sin(a) * 0.4]); }
    over(() => poly3(tn, P, nose, T(PAPER, 1))); poly3(tn, P, nose, T(GOLD, 0.2));
    const shade = []; for (let i = 0; i <= 12; i++) { const a = Math.PI * i / 12; shade.push([c[0] + Math.cos(a) * bw * 0.2, 0.6 + Math.sin(a) * 1.2, tz - 0.3]); } poly3(tn, P, shade, T(BLK, 0.3));
    const ws = []; for (let i = 0; i <= 12; i++) { const a = Math.PI * i / 12; ws.push([c[0] - Math.cos(a) * bw * 0.72, 2.3 + Math.sin(a) * 0.9, tz - 0.25]); } poly3(tn, P, ws, T(BLK, 0.9));
    poly3(tn, P, [[c[0] - bw, 0.6, tz], [c[0] + bw, 0.6, tz], [c[0] + bw, 1.0, tz], [c[0] - bw, 1.0, tz]], T(RED, 1));
    kk.lineWidth = clamp(40 / tz * 20, 1, 5); kk.strokeStyle = ink(BLK, 1); kk.beginPath(); nose.forEach((q, i) => { const [x, y] = P(q); i ? kk.lineTo(x, y) : kk.moveTo(x, y); }); kk.closePath(); kk.stroke();
    kk.beginPath(); side.forEach((q, i) => { const [x, y] = P(q); i ? kk.lineTo(x, y) : kk.moveTo(x, y); }); kk.stroke();
    for (const hx of [-1.05, 1.05]) { const [x, y] = P([c[0] + hx, 1.35, tz - 0.3]), rr = clamp(260 / tz, 2, 60); ko.beginPath(); ko.arc(x, y, rr * 1.3, 0, TAU); ko.fill(); sp.fillStyle = ink(GOLD, 1); sp.beginPath(); sp.arc(x, y, rr, 0, TAU); sp.fill();
      over(() => { const gg = tn.createRadialGradient(x, y, 0, x, y, rr * 6); gg.addColorStop(0, T(PAPER, 0.9)); gg.addColorStop(1, T(PAPER, 0)); tn.fillStyle = gg; tn.fillRect(x - rr * 6, y - rr * 6, rr * 12, rr * 12); }); }
    const [px0, py0] = P([c[0], 5.6, tz + 4]), [px1, py1] = P([c[0], 3.4, tz + 4]); kk.lineWidth = 2; kk.beginPath(); kk.moveTo(px0, py0); kk.lineTo(px1 - 8, py1); kk.moveTo(px0, py0); kk.lineTo(px1 + 8, py1); kk.stroke();
  }
  { const far = [], mid = [];
    for (let k = 0; k < 10; k++) { const z = 40 + k * 26, q = P([-3.2 - (k % 2) * 0.6, 0, z]); if (q[2] > 1) far.push([q[0], q[1], 1.8 * P.F / q[2], k % 3 ? 'walk' : 'sledge', 0]); }
    for (let k = 0; k < 5; k++) { const z = 9 + k * 5, q = P([-2.9 - (k % 2) * 0.5, 0, z]); if (q[2] > 1) mid.push([q[0], q[1], 1.8 * P.F / q[2], ['sledge', 'shovel', 'walk', 'heave', 'standC'][k], 0]); }
    crew2([...far, ...mid, [120, 1860, 400, 'sledge'], [330, 1830, 380, 'walk'], [930, 1880, 410, 'shovel', 1]], t, 52); }
  motes(52, 40, t, -40, 10, 0.6);
  return { cell: 9, misreg: 1.6 };
}
// 54-56 POWER.: lattice towers erected to the horizon; the line goes live
function shotPower(b, t) {
  const u = (b - 54) / 2, P = cam3([-22 + 10 * u, 5, -28 + 12 * u], [28, 34, 220], 60);
  const hy = P([0, 0, 6000])[1];
  skyTone(ink(RED, 0.85), ink(GOLD, 0.7), hy, 300, hy - 80, 0.6);
  clouds(29, 7, 180, hy - 120, t * 70, BLK, 0.14, 1.2);
  tn.fillStyle = T(GOLD, 0.85); tn.fillRect(0, hy, W, H - hy); tn.fillStyle = T(RED, 0.35); tn.fillRect(0, hy, W, H - hy);
  { const fg = tn.createLinearGradient(0, hy, 0, H); fg.addColorStop(0, T(BLK, 0)); fg.addColorStop(1, T(BLK, 0.45)); tn.fillStyle = fg; tn.fillRect(0, hy, W, H - hy); }
  for (let k = -40; k <= 40; k++) seg3(kk, P, [k * 7 - 100, 0, 4], [k * 7 - 100, 0, 3000], 0.05, BLK, 0.7);
  for (let z = 6; z < 900; z *= 1.18) seg3(kk, P, [-400, 0, z], [400, 0, z], 0.03, BLK, 0.4);
  // the plant: two cooling towers and their steam, the turbine hall
  for (const [x0, z0] of [[-230, 700], [-150, 760]]) {
    const prof = []; for (let i = 0; i <= 20; i++) { const yy = i * 4.5, w = 22 * (0.72 + 0.28 * Math.pow((yy - 60) / 60, 2)); prof.push([x0 - w, yy, z0]); }
    for (let i = 20; i >= 0; i--) { const yy = i * 4.5, w = 22 * (0.72 + 0.28 * Math.pow((yy - 60) / 60, 2)); prof.push([x0 + w, yy, z0]); }
    poly3(tn, P, prof, T(BLK, 0.45)); kk.lineWidth = 1.6; kk.strokeStyle = T(BLK, 0.8); kk.beginPath(); prof.forEach((q, i) => { const [x, y] = P(q); i ? kk.lineTo(x, y) : kk.moveTo(x, y); }); kk.closePath(); kk.stroke();
    for (let j = 0; j < 9; j++) { const q = (t * 0.25 + j / 9) % 1, [x, y] = P([x0 + q * 40, 90 + q * 120, z0]), rr = (30 + q * 110) * P.F / (P.depth([x0, 90, z0]) * 1.6);
      over(() => { const gg = tn.createRadialGradient(x, y, 0, x, y, rr); gg.addColorStop(0, T(PAPER, 0.85)); gg.addColorStop(1, T(PAPER, 0)); tn.fillStyle = gg; tn.fillRect(x - rr, y - rr, rr * 2, rr * 2); });
      tn.fillStyle = T(BLK, 0.1); tn.beginPath(); tn.arc(x + rr * 0.2, y + rr * 0.3, rr * 0.6, 0, TAU); tn.fill(); }
  }
  const hall = [[-110, 0, 720], [-40, 0, 720], [-40, 22, 720], [-110, 22, 720]]; poly3(tn, P, hall, T(BLK, 0.6));
  for (let k = 0; k < 10; k++) { const [x, y] = P([-106 + k * 7, 14, 719]); ko.fillRect(x, y, 6, 8); sp.fillStyle = ink(GOLD, 1); sp.fillRect(x, y, 6, 8); }
  // the line: towers rise one by one toward the horizon
  const N = 12, towers = [];
  for (let i = 0; i < N; i++) { const z = 30 + i * 105, x = 18 + i * 9, rise = ease.outBack(clamp((u * 1.35 - i * 0.07) / 0.18)); towers.push({ x, z, rise }); }
  const live = clamp((u - 0.62) / 0.3);
  const arms = [[32, 12], [40, 9]];
  towers.forEach((T2, i) => {
    if (T2.rise <= 0) return; const h = 46 * T2.rise;
    lattice(kk, P, [T2.x, 0, T2.z], h, 5.2, 0.8, 8, 0.16);
    for (const [ay, span] of arms) if (h > ay) { seg3(kk, P, [T2.x - span, ay * T2.rise, T2.z], [T2.x + span, ay * T2.rise, T2.z], 0.3); seg3(kk, P, [T2.x - span, ay * T2.rise, T2.z], [T2.x - 1.5, (ay + 4) * T2.rise, T2.z], 0.14); seg3(kk, P, [T2.x + span, ay * T2.rise, T2.z], [T2.x + 1.5, (ay + 4) * T2.rise, T2.z], 0.14); }
    const nx = towers[i + 1]; if (!nx || nx.rise < 0.98 || T2.rise < 0.98) return;
    for (const [ay, span] of arms) for (const sx of [-span, span]) {
      const pts = []; for (let k = 0; k <= 14; k++) { const f = k / 14, x = lerp(T2.x, nx.x, f) + sx, y = ay - 3 - 5 * Math.sin(Math.PI * f), z = lerp(T2.z, nx.z, f); const q = P([x, y, z]); pts.push(q[2] > 1 ? [q[0], q[1]] : null); }
      strokeRun(kk, pts, clamp(3 * P.F / P.depth([T2.x, 30, T2.z]) * 0.05, 0.8, 4), ink(BLK, 1));
      if (live > 0) { const on = clamp(live * N - i); if (on > 0) { strokeRun(ko, pts, 3.5, PAPER); strokeRun(sp, pts, 2.2, ink(GOLD, on)); } }
    }
  });
  if (live > 0) { const [x, y] = P([towers[0].x, 40, towers[0].z]); over(() => { const gg = tn.createRadialGradient(x, y, 0, x, y, 300); gg.addColorStop(0, T(GOLD, 0.6 * live)); gg.addColorStop(1, T(GOLD, 0)); tn.fillStyle = gg; tn.fillRect(x - 300, y - 300, 600, 600); }); }
  // near ground: the foundation crew's bolts and a spool, as the near plane
  tn.fillStyle = T(BLK, 0.85); tn.beginPath(); tn.moveTo(0, H); tn.lineTo(0, 1720); tn.quadraticCurveTo(540, 1660, W, 1760); tn.lineTo(W, H); tn.fill();
  { const crew = [], T0 = towers[1]; if (T0 && T0.rise > 0.95) { const q = P([T0.x + 30, 32 * T0.rise + 0.3, T0.z]), hh = 1.9 * P.F / Math.max(1, P.depth([T0.x, 32, T0.z])); crew.push(workerPath(q[0], q[1], hh, POSES.pry, -1)); }
    const gp = [760, 1790]; kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 10; kk.beginPath(); kk.moveTo(gp[0], gp[1]); kk.lineTo(gp[0] + 170, 980); kk.stroke();
    kk.lineWidth = 3; kk.beginPath(); kk.moveTo(gp[0] + 170, 980); kk.lineTo(330, 1560); kk.moveTo(gp[0] + 170, 980); kk.lineTo(gp[0] + 250, 1400); kk.stroke();
    rimmed(crew, 0, -4, 5, 1);
    const mid = []; for (let k = 0; k < 6; k++) { const q = P([T0 ? T0.x - 14 + k * 5 : k * 5, 0, T0 ? T0.z - 8 + (k % 2) * 6 : 120]); if (q[2] > 1) mid.push([q[0], q[1], 1.8 * P.F / q[2], ['heave', 'walk', 'shovel', 'standA', 'walk', 'sledge'][k], k % 2]); }
    crew2([...mid, [230, 1770, 330, 'heave'], [400, 1790, 340, 'heave'], [560, 1800, 320, 'walk']], t, 54); }
  motes(54, 45, t, 30, -20, 0.7);
  return { cell: 9, misreg: 1.6 };
}
// 56-60 THE WORKING CLASS / BUILDS: the Richmond hull on the ways, then the launch
function shotHull(b, t) {
  const u = (b - 56) / 4, slide = ease.inOutCubic(clamp((b - 58.05) / 1.9)) * 150;
  const P = cam3([178 - 20 * u, 6 + 3 * u, -46 + 6 * u], [72, 10, 4], 56);
  const hy = P([0, 0, 5000])[1];
  skyTone(ink(GOLD, 0.8), ink(GOLD, 0.45), hy, 250, hy - 200, 0.9);
  clouds(39, 6, 200, hy - 200, t * 60, BLK, 0.1, 1.3);
  tn.fillStyle = T(BLK, 0.3); tn.beginPath(); tn.moveTo(0, hy); for (let x = 0; x <= W; x += 18) tn.lineTo(x, hy - 26 - 26 * Math.sin(x * 0.005) - 8 * Math.sin(x * 0.04)); tn.lineTo(W, hy); tn.fill();
  tn.fillStyle = T(BLK, 0.55); tn.fillRect(0, hy, W, H - hy);
  // the ways and the yard ground
  const slope = 0.045, wy = x => (x + 20) * slope;
  poly3(tn, P, [[-20, 0, -30], [160, 0, -30], [160, 0, 60], [-20, 0, 60]], T(BLK, 0.4));
  for (let z = -28; z < 60; z += 1.6) seg3(kk, P, [-20, 0.02, z], [160, 0.02, z], 0.03, BLK, 0.5);
  for (let x = -20; x < 160; x += 9) seg3(kk, P, [x, 0.02, -30], [x, 0.02, 60], 0.03, BLK, 0.4);
  for (const z of [-4, 4]) { seg3(kk, P, [-40, wy(-40) - 1.8, z], [150, wy(150) - 1.8, z], 0.35); seg3(sp, P, [-40, wy(-40) - 1.6, z], [150, wy(150) - 1.6, z], 0.1, GOLD); }
  // water beyond the stern
  poly3(tn, P, [[-300, -0.5, -60], [-20, -0.5, -60], [-20, -0.5, 400], [-300, -0.5, 400]], T(BLK, 0.5));
  // hull: stations along x, visible side z = +breadth
  const hb = x => { const m = 8.6; if (x > 105) return m * Math.sqrt(Math.max(0, 1 - Math.pow((x - 105) / 30, 2))); if (x < 18) return m * (0.55 + 0.45 * x / 18); return m; };
  const deck = x => 11.5 + (x > 100 ? Math.pow((x - 100) / 35, 2) * 2.5 : 0) + (x < 10 ? (10 - x) * 0.08 : 0);
  const X = x => x - slide, Yw = (x, y) => y + Math.max(wy(x - slide), -0.6);   // off the ways, she floats
  const top = [], bot = [];
  for (let x = 0; x <= 135; x += 2.5) { top.push([X(x), Yw(x, deck(x)), hb(x)]); bot.push([X(x), Yw(x, 1.0), hb(x) * 0.88]); }
  const side = top.concat(bot.slice().reverse());
  poly3(tn, P, side, T(RED, 0.85)); poly3(tn, P, side, T(BLK, 0.28));
  const lit = tn.createLinearGradient(0, P(top[0])[1], 0, P(bot[0])[1]); lit.addColorStop(0, T(BLK, 0)); lit.addColorStop(1, T(BLK, 0.35)); tn.fillStyle = lit;
  tn.beginPath(); side.forEach((q, i) => { const [x, y] = P(q); i ? tn.lineTo(x, y) : tn.moveTo(x, y); }); tn.closePath(); tn.fill();
  kk.lineWidth = 3; kk.strokeStyle = ink(BLK, 1); kk.beginPath(); side.forEach((q, i) => { const [x, y] = P(q); i ? kk.lineTo(x, y) : kk.moveTo(x, y); }); kk.closePath(); kk.stroke();
  for (const yy of [2.5, 4.5, 6.5, 8.5, 10.3]) { kk.lineWidth = 1.1; kk.beginPath(); for (let x = 0; x <= 135; x += 2.5) { if (yy > deck(x)) continue; const [px, py] = P([X(x), Yw(x, yy), hb(x) * lerp(0.88, 1, yy / 11.5) + 0.02]); x ? kk.lineTo(px, py) : kk.moveTo(px, py); } kk.stroke(); }
  for (let x = 6; x < 132; x += 6) { const [a1, a2] = [P([X(x), Yw(x, 1.2), hb(x) * 0.9]), P([X(x), Yw(x, deck(x) - 0.2), hb(x)])]; kk.lineWidth = 0.9; kk.beginPath(); kk.moveTo(a1[0], a1[1]); kk.lineTo(a2[0], a2[1]); kk.stroke(); }
  // the stencil on the bow: RICHMOND (in-world texture, never a frame line)
  { const a = P([X(108), Yw(108, 8.6), hb(108) + 0.05]), c = P([X(128), Yw(128, 8.9), hb(128) + 0.05]), d = P([X(108), Yw(108, 6.2), hb(108) + 0.05]);
    const w0 = 520, h0 = 80; ko.save(); ko.setTransform((c[0] - a[0]) / w0, (c[1] - a[1]) / w0, (d[0] - a[0]) / h0, (d[1] - a[1]) / h0, a[0], a[1]);
    ko.font = '700 76px "Oswald"'; ko.textAlign = 'left'; ko.textBaseline = 'top'; ko.fillStyle = PAPER; ko.fillText('RICHMOND', 0, 0); ko.restore(); }
  // scaffolding in front of the hull (until the launch), whirley cranes on the yard rails
  if (slide < 1) for (let x = 8; x < 128; x += 6) { const z = hb(x) + 2.2; seg3(kk, P, [x, wy(x), z], [x, wy(x) + deck(x) + 1.5, z], 0.14); for (let yy = 2; yy < deck(x); yy += 2.2) seg3(kk, P, [x, wy(x) + yy, z], [x + 6, wy(x + 6) + yy, z], 0.08); }
  for (const [cx0, ph] of [[20, 0], [75, 1.7], [120, 3.1]]) {
    const baseP = [cx0, 0, 26], top2 = lattice(kk, P, baseP, 34, 3.2, 1.6, 6, 0.15);
    const ang = 2.4 + 0.5 * Math.sin(t * 0.4 + ph) + (b >= 58 ? (b - 58) * 0.2 : 0), bl = 34;
    const end = [cx0 + Math.cos(ang) * bl, 34 + 14, 26 + Math.sin(ang) * bl];
    seg3(kk, P, top2, end, 0.3); seg3(kk, P, [top2[0], top2[1] + 6, top2[2]], end, 0.1); seg3(kk, P, [top2[0], top2[1] + 6, top2[2]], [cx0 - Math.cos(ang) * 8, 34, 26 - Math.sin(ang) * 8], 0.1);
    seg3(kk, P, end, [end[0], 12 + 3 * Math.sin(t + ph), end[2]], 0.04); poly3(tn, P, [[cx0 - 3, 30, 23], [cx0 + 3, 30, 23], [cx0 + 3, 36, 23], [cx0 - 3, 36, 23]], T(RED, 0.9));
  }
  // the launch: the stern meets the water
  if (slide > 2) { const [sx, sy] = P([X(0) + 1, 0, 0]); for (let k = 0; k < 60; k++) { const q = ((b - 58.15) * 1.2 + k / 60) % 1, a = -Math.PI * (0.2 + 0.6 * ((k * 0.618) % 1)), v = 120 + (k * 53 % 220);
    const x = sx + Math.cos(a) * v * q * 2, y = sy + Math.sin(a) * v * q * 2 + 300 * q * q, rr = 6 + 14 * q;
    over(() => { tn.fillStyle = T(PAPER, 0.8 * (1 - q)); tn.beginPath(); tn.arc(x, y, rr, 0, TAU); tn.fill(); }); kk.lineWidth = 1; kk.beginPath(); kk.arc(x, y, rr, 0, TAU); kk.stroke(); } }
  // the yard's day board: 244 DAYS struck through, 42 in gold. It stands by the ways (56-58); on the launch (b58) it
  // swings up to fill the frame at plant size: the board is the frame's words, not a caption.
  // v9: the day board is the Richmond record a stranger reads at once: SS Robert E. Peary, keel to launch in 4 days
  // 15 h 29 min (Nov 1942). It stands by the ways (56-58) with its number blank; on the launch (b58) it swings up to
  // plant size and the number flips in (a flip-slam): the board is the frame's words, not a caption.
  { const big = ease.outExpo(clamp((b - 58) / 0.25)), bw = 420, bh = 340, sc = lerp(0.9, 2.25, big), bx = lerp(80, 540 - bw * 2.25 / 2, big), by = lerp(1330, 480, big);
    ko.save(); kk.save(); sp.save(); tn.save();
    for (const c of [ko, kk, sp, tn]) { c.translate(bx, by); c.scale(sc, sc); c.rotate(-0.12 * (1 - big)); }
    if (big > 0.2) { clearRect(-3, -3, bw + 6, bh + 6, [kk, sp, ko]); over(() => { tn.fillStyle = T(PAPER, 1); tn.fillRect(0, 0, bw, bh); }); }   // v9: an opaque board: no crane or hull prints through it
    tn.fillStyle = T(BLK, 0.92); tn.fillRect(0, 0, bw, bh); kk.lineWidth = 6 / sc; kk.strokeStyle = ink(BLK, 1); kk.strokeRect(0, 0, bw, bh);
    kk.lineWidth = 8; if (big < 0.5) { kk.beginPath(); kk.moveTo(70, bh); kk.lineTo(70, 700); kk.moveTo(bw - 70, bh); kk.lineTo(bw - 70, 700); kk.stroke(); }
    ko.fillStyle = PAPER; ko.textAlign = 'center'; ko.font = '700 34px "Oswald"'; ko.fillText('ONE SHIP, KEEL TO LAUNCH', bw / 2, 52);
    ko.fillRect(24, 68, bw - 48, 3);
    const n = b >= 58 ? (b < 58.12 ? String(1 + Math.floor(b * 91) % 9) : '4') : '–';
    sp.fillStyle = ink(GOLD, 1); ko.font = '700 170px "Oswald"'; ko.textAlign = 'right'; ko.fillText(n, 170, 238); sp.font = ko.font; sp.textAlign = 'right'; sp.fillText(n, 170, 238);
    ko.font = '700 92px "Oswald"'; ko.textAlign = 'left'; ko.fillText('DAYS', 188, 236); sp.font = ko.font; sp.textAlign = 'left'; sp.fillText('DAYS', 188, 236);
    ko.textAlign = 'center'; ko.font = '700 27px "Oswald"'; ko.fillText('15 HRS 29 MIN · RICHMOND, CA · 1942', bw / 2, 300);
    ko.restore(); kk.restore(); sp.restore(); tn.restore(); }
  // the yard crowd at the ways, from behind: hats, caps, shoulders; on the launch the hats go up
  over(() => { const g = tn.createLinearGradient(0, 1380, 0, 1700); g.addColorStop(0, T(PAPER, 0)); g.addColorStop(0.5, T(PAPER, 0.85)); g.addColorStop(1, T(GOLD, 0.5)); tn.fillStyle = g; tn.fillRect(0, 1380, W, 540); });
  crowdMass(1500, 1840, 3, 58, t, { hats: 0.8, lit: 1, bob: b >= 58 ? 1 : 0.2 });
  if (b >= 58.05) { const r = rng(59), hats = []; for (let i = 0; i < 26; i++) { const q = clamp((b - 58.05 - r() * 0.3) / 1.6), x = r() * W + (r() - 0.5) * 200 * q, y = 1560 + r() * 200 - 900 * q * (2 - q) * (0.6 + r() * 0.5), a = q * (r() - 0.5) * 12, sz = 16 + r() * 16;
    if (q <= 0) continue; const h2 = new Path2D(); const m2 = new DOMMatrix().translateSelf(x, y).rotateSelf(a * 57.3); const hq = new Path2D(); hq.ellipse(0, 0, sz * 1.45, sz * 0.26, 0, 0, TAU); h2.addPath(hq, m2); hats.push(h2);
      const hs = new Path2D(); hs.moveTo(-sz * 1.05, 0); hs.bezierCurveTo(-sz * 1.05, -sz * 1.35, sz * 1.05, -sz * 1.35, sz * 1.05, 0); hs.closePath(); const h3 = new Path2D(); h3.addPath(hs, m2); hats.push(h3); }
    rimmed(hats, 0, -3, 3, 1); }
  motes(56, 50, t, 20, -25, 0.7);
  return { cell: 9, misreg: 1.6 + (b >= 58 ? 5 * Math.exp(-(b - 58) * 6) : 0) };
}
// 60-64 A CIVILIZATION / RISING.: the continent at night, its lights thicken and become the gear
const NET = (() => { const pts = CITY.slice(0, 500), out = [];
  pts.forEach((a, i) => { const near = pts.map((c, j) => [j, (c[2] - a[2]) ** 2 + ((c[3] - a[3]) * 0.78) ** 2]).filter(([j]) => j !== i).sort((x, y) => x[1] - y[1]).slice(0, 2);
    for (const [j, d] of near) if (d < 16 && j > i) out.push([i, j]); }); return out; })();
const GEAR = (() => { const M = BRAND.acp_mark, c = document.createElement('canvas'), s = 200 / Math.max(M.width, M.height); c.width = Math.round(M.width * s); c.height = Math.round(M.height * s);
  const g2 = c.getContext('2d', { willReadFrequently: true }); g2.drawImage(M, 0, 0, c.width, c.height); const d = g2.getImageData(0, 0, c.width, c.height).data, pts = [];
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 128) pts.push([(x - c.width / 2) / 100, (y - c.height / 2) / 100]);
  const r = rng(64); for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  return { pts, w: c.width / 100, h: c.height / 100 }; })();
function shotCivilization(b, t) {
  // v9 60-64 A CIVILIZATION RISING.: the brightest frame of the piece. Bare stock sky, the red continent low in the
  // frame, and over it the mark comes up like the sun: the 750 homecoming lights lift out of their towns and stream
  // together into the gear (not a stamp on the map: it rises off it), its rays thrown across the sky. The plates slide
  // into register and lock on b62; then a slow push-in, no settle.
  const u = ease.outCubic(clamp((b - 60) / 1.6)), push = 1 + 0.035 * Math.max(0, b - 62) ** 1.2;
  const A = albers(lerp(-93, -96.5, u), lerp(39, 38.5, u), lerp(1700, 1500, u) * push, 540, lerp(1900, 1760, u));
  over(() => { tn.fillStyle = T(PAPER, 1); tn.fillRect(0, 0, W, H); });
  const reg = ease.inOutCubic(clamp((b - 60.05) / 1.9)), lock = b >= 62 ? Math.exp(-(b - 62) * 5) : 0, off = 1 - reg;
  const gcx = 540, gcy = lerp(1560, 1330, ease.outCubic(clamp((b - 60) / 2))) - 20 * Math.max(0, b - 62), gs = 560 * push, rot = Math.max(0, b - 62) * 0.06;
  // the rays of the rising mark, over the sky and the continent's upper edge
  { kk.save(); kk.beginPath(); kk.rect(0, 0, W, gcy + 40); kk.clip(); sp.save(); sp.beginPath(); sp.rect(0, 0, W, gcy + 40); sp.clip();
    for (let k = 0; k < 19; k++) { const a = Math.PI + (k + 0.5) * Math.PI / 19, L = 700 + 900 * u, r0 = gs * 0.56;
      const p0 = [gcx + Math.cos(a) * r0, gcy + Math.sin(a) * r0], p1 = [gcx + Math.cos(a) * (r0 + L), gcy + Math.sin(a) * (r0 + L)];
      const c = k % 2 ? sp : kk; c.strokeStyle = k % 2 ? ink(GOLD, 1) : ink(RED, 0.95); c.lineWidth = k % 2 ? 6 : 11; c.beginPath(); c.moveTo(...p0); c.lineTo(...p1); c.stroke(); }
    kk.restore(); sp.restore(); }
  { const UP = P2(A, US48); over(() => { tn.fillStyle = T(RED, 1); tn.fill(UP); }); kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 3; kk.stroke(P2(A, COAST48));
    kk.setLineDash([7, 5]); kk.lineWidth = 1.4; kk.strokeStyle = ink(BLK, 0.7); kk.stroke(P2(A, STATE_LINES)); kk.setLineDash([]); }
  ko.lineWidth = 4; sp.lineWidth = 2.2; sp.strokeStyle = ink(GOLD, 1 - 0.5 * reg); ko.beginPath(); sp.beginPath();
  for (const [i, j] of NET) { const a2 = A([CITY[i][3], CITY[i][2]]), c = A([CITY[j][3], CITY[j][2]]); ko.moveTo(a2[0], a2[1]); ko.lineTo(c[0], c[1]); sp.moveTo(a2[0], a2[1]); sp.lineTo(c[0], c[1]); }
  ko.stroke(); sp.stroke();
  const M = BRAND.acp_mark, mh = gs * M.height / Math.max(M.width, M.height), mw = gs * M.width / Math.max(M.width, M.height);
  const plate = (c, img, dx, dy, a = 1) => { c.save(); c.translate(gcx + dx, gcy + dy); c.rotate(rot); c.globalAlpha = a; c.drawImage(img, -mw / 2, -mh / 2, mw, mh); c.restore(); };
  // the solid plates come in only as the lights arrive: black tone from the lower left, the keyline from the upper right
  const solid = clamp((b - 61.3) / 0.6);
  plate(tn, tintedTo(BLK), -120 * off, 90 * off, solid);
  plate(kk, keyline(), 110 * off, -90 * off, solid);
  // the 750 homecoming lights: each lifts out of its home town and streams to its place in the gear
  const N = 750, step = Math.max(1, Math.floor(GEAR.pts.length / N)), cr = Math.cos(rot), sr = Math.sin(rot), gsc = gs / Math.max(GEAR.w, GEAR.h);
  for (let i = 0; i < N; i++) {
    const h = bases[i].home, [mx, my] = A([h.lo, h.la]), g = GEAR.pts[(i * step) % GEAR.pts.length];
    const gx = gcx + (g[0] * cr - g[1] * sr) * gsc, gy = gcy + (g[0] * sr + g[1] * cr) * gsc;
    const d = ease.inOutCubic(clamp(reg * 1.4 - ((i * 0.618) % 1) * 0.4)), x = lerp(mx, gx, d), y = lerp(my, gy, d) - Math.sin(Math.PI * d) * 120, s2 = lerp(2.6, 5.2, d);
    const fade = 1 - clamp((b - 61.85) / 0.3); if (fade <= 0) break;
    ko.beginPath(); ko.arc(x, y, s2 + 1.4, 0, TAU); ko.fill(); sp.fillStyle = ink(GOLD, fade); sp.beginPath(); sp.arc(x, y, s2, 0, TAU); sp.fill();
    if (d > 0.05 && d < 0.95) { sp.strokeStyle = ink(GOLD, 0.5 * fade); sp.lineWidth = 1.5; sp.beginPath(); sp.moveTo(x, y); sp.lineTo(lerp(mx, gx, d * 0.8), lerp(my, gy, d * 0.8) - Math.sin(Math.PI * d * 0.8) * 120); sp.stroke(); }
  }
  if (lock > 0.01) { sp.strokeStyle = ink(GOLD, lock); sp.lineWidth = 6; sp.beginPath(); sp.arc(gcx, gcy, gs * 0.5 + (1 - lock) * 320, 0, TAU); sp.stroke(); }
  return { cell: 9, misreg: 1.6 * (1 - clamp((b - 61.7) / 0.3)) + 5 * off + 3 * lock, flash: b >= 60.07 && b < 60.14 ? 0.35 : b >= 62 && b < 62.07 ? 0.3 : 0 };
}
// the lockup on the piece's own red: the ☭≡/acc sigil in paper with a press-black accent, printed off register
// and slammed home in 4 frames (the payoff's register move, once more)
function lockup(c, age) {
  c.fillStyle = RED; c.fillRect(0, 0, W, H);
  const k = Math.exp(-age * 12), a = clamp(0.6 + age / 0.1), s = 230 * (1 + 0.25 * k);
  c.save(); c.globalCompositeOperation = 'multiply'; sigil(c, W / 2 - 14 * k, 866 + 10 * k, s, { color: BLK, alpha: 0.35 * a }); c.restore();
  sigil(c, W / 2, 860, s, { color: PAPER, accent: BLK, alpha: a });
  line(c, 'ACP.US', W / 2, 1190, { family: 'Archivo Black', size: 76, color: PAPER, alpha: clamp(0.5 + age * 4) });
  c.save(); c.globalCompositeOperation = 'multiply'; c.fillStyle = c.createPattern(Sp2, 'repeat'); c.globalAlpha = 0.05; c.fillRect(0, 0, W, H); c.restore();
}
let _key = null;
function keyline() {   // the mark's outline: dilated 5 px in 12 directions, minus the mark
  if (_key) return _key; const M = BRAND.acp_mark, [c, g2] = mk(M.width + 24, M.height + 24), k = Math.max(M.width, M.height) / 470 * 6;
  for (let i = 0; i < 12; i++) { const a = i * TAU / 12; g2.drawImage(M, 12 + Math.cos(a) * k, 12 + Math.sin(a) * k); }
  g2.globalCompositeOperation = 'destination-out'; g2.drawImage(M, 12, 12); g2.globalCompositeOperation = 'source-in'; g2.fillStyle = BLK; g2.fillRect(0, 0, c.width, c.height);
  const [c2, g3] = mk(M.width, M.height); g3.drawImage(c, -12, -12); return (_key = c2);
}
const tintCache = {};
function tintedTo(col) { if (tintCache[col]) return tintCache[col]; const M = BRAND.acp_mark, [c, g2] = mk(M.width, M.height); g2.drawImage(M, 0, 0); g2.globalCompositeOperation = 'source-in'; g2.fillStyle = col; g2.fillRect(0, 0, M.width, M.height); return (tintCache[col] = c); }

// ================================================================ type: two riso drums in the scene's own inks
// Each frame is set once (setBlock, the role ladder, the safe band) and printed like the sheet under it:
//   knock-out  the tone, key and spot plates are cut back to bare paper under the glyphs only, a hard edge ~10 px out
//   drum 1     press black (the chant word BUILD in red) lands on the frame's hit, with the feed smear
//   drum 2     red lands half a beat later on the next snare, 8-12 px off register, settling to the sheet's misreg
typeAudit.plantCap = PLANT;
const drum = riso({ seed: 11, speckle: 0.42, streak: 0.08 });
const blockCache = new Map();
function blockOf(text) {
  if (blockCache.has(text)) return blockCache.get(text);
  const T0 = TYPESET[text], rows = T0.rows;
  const blk = setBlock(stencilF, rows.map(([t, cap, f, sx]) => ({ text: t, cap, max: cap, fill: true, sx: sx || 1 })),
    { role: T0.role, y: T0.y, gap: T0.gap ?? 0.16 });
  const chant = rows.map((r, i) => r[2] === 'c' ? i : -1).filter(i => i >= 0), plain = rows.map((r, i) => i).filter(i => !chant.includes(i));
  const path = new Path2D(); for (const G of blk.glyphs) path.addPath(G.path, new DOMMatrix().translateSelf(G.ox, G.oy));
  const o = { blk, path, chant, plain, T0 };
  blockCache.set(text, o); return o;
}
const liveCue = beat => CUES.find(c => c.text && beat >= c.s && beat < c.e);
const kindOf = text => (TYPESET[text] && TYPESET[text].kind) || 'held';
const SLAM_F = 6;                                                     // a slam is on for 6 frames from its hit
// the payoff's sheet feeds UP out of the bottom of the frame on the b60 key change
const riseOf = (text, beat) => text === 'A CIVILIZATION RISING.' ? (1 - ease.outExpo(clamp((beat - 68) / 0.55))) * 1300 : 0;
const slamOn = (cu, beat) => (beat - cu.s) * B.spb < SLAM_F / 30 - 1e-6;
// the knock-out: bare paper under the letters on every plate, a hard edge 2 px out. v9: no wash, no plate, no halo.
// A slam cuts its words out of the whole press sheet (tone, key and spot) so they read as bare stock through the red.
function typeKnock(beat) {
  const cu = liveCue(beat); if (!cu) return;
  const kind = kindOf(cu.text); if (kind === 'world' || (kind === 'slam' && !slamOn(cu, beat))) return;
  const { path: path0 } = blockOf(cu.text), ry = riseOf(cu.text, beat);
  const path = ry ? (() => { const q = new Path2D(); q.addPath(path0, new DOMMatrix().translateSelf(0, ry)); return q; })() : path0;
  over(() => { tn.fillStyle = T(PAPER, 1); tn.fill(path); });
  for (const c of [kk, sp]) { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000'; c.strokeStyle = '#000'; c.lineWidth = 4; c.fill(path); c.stroke(path); c.restore(); }
  ko.save(); ko.fillStyle = PAPER; ko.strokeStyle = PAPER; ko.lineWidth = 4; ko.fill(path); ko.stroke(path); ko.restore();
}
// Struck riso (Mayakovsky's ROSTA windows: cut stencil, two inks, a new panel on every beat). Two drums: press black
// for the words, red for the frame's key word. Frame 1 of a cue is the feed smear (3 copies, 24-40 px down), frame 2
// the drum skewed ~1.25°, frame 3 on it sits with the red drum 4-6 px off the black. The payoff closes to 0 on b62.
const inkDrum = riso({ seed: 11, speckle: 0.12, streak: 0.02 });
function strike(P, age, reg, alpha = 1) {
  if (age < 0) return;
  const f = Math.floor(age * 30 + 1e-6);
  if (f === 0) { for (const [dy, a] of [[40, 0.2], [24, 0.3], [0, 0.9]]) inkDrum.print(ctx, P, 0.05, { reg: [reg[0], reg[1] + dy], alpha: alpha * a }); return; }
  if (f === 1) { inkDrum.print(ctx, P, 0.05, { reg: [reg[0] * 1.6, reg[1] * 1.6 + 6], rot: 0.022, alpha }); return; }
  inkDrum.print(ctx, P, 0.05, { reg, alpha });
}
// the slam's red plate: the band of the sheet in red with the words cut out of it (they read as the bare stock)
const slamPlates = new Map();
function slamPlate(text) {
  if (slamPlates.has(text)) return slamPlates.get(text);
  const { blk } = blockOf(text), bb = blk.bbox, y0 = Math.max(150, bb.y1 - 120), y1 = Math.min(1790, bb.y2 + 120);
  const fn = g => { g.fillRect(24, y0, W - 48, y1 - y0); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    for (const G of blk.glyphs) { g.save(); g.translate(G.ox, G.oy); g.fill(G.path); g.restore(); }
    g.lineWidth = 3; g.strokeStyle = '#000'; for (const G of blk.glyphs) { g.save(); g.translate(G.ox, G.oy); g.stroke(G.path); g.restore(); } };
  const P = inkDrum.plate(fn, RED, { key: 'slam:' + text });
  slamPlates.set(text, P); return P;
}
function drawType(beat, m) {
  typeAudit.reset();
  const cu = liveCue(beat); if (!cu) return;
  const kind = kindOf(cu.text); if (kind === 'world') return;
  const { blk, chant, plain } = blockOf(cu.text); let age = (beat - cu.s) * B.spb;
  if (kind === 'slam') {
    if (!slamOn(cu, beat)) return;
    const f = Math.floor(age * 30 + 1e-6), k = f === 0 ? 1.05 : 1, [cx, cy] = [(blk.bbox.x1 + blk.bbox.x2) / 2, (blk.bbox.y1 + blk.bbox.y2) / 2];
    ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
    strike(slamPlate(cu.text), age, f < 2 ? [0, 0] : [3, -2], 0.96);
    ctx.restore();
    typeAudit.add(blk, { role: blk.role, read: age >= 0.034 ? 1 : 0.6, s: k });
    return;
  }
  if (cu.s === 0) age = Math.max(age, 0.2);                           // frame 0 is the thumbnail: already printed and sitting
  let off = [5, -4];                                                  // the red drum's settled misregistration
  let rise = 0;
  if (cu.text === 'A CIVILIZATION RISING.') {                         // the sheet feeds UP out of the bottom of the frame on the key change
    const k = 1 - ease.inOutCubic(clamp((beat - 69.6) / 0.4)); off = [7 * k, -6 * k];
    rise = riseOf(cu.text, beat);
  }
  const slap = cu.s > 0 && age < 0.1 ? lerp(1.03, 1, age / 0.1) : 1, [cx, cy] = [(blk.bbox.x1 + blk.bbox.x2) / 2, (blk.bbox.y1 + blk.bbox.y2) / 2];
  ctx.save(); ctx.translate(0, rise); ctx.translate(cx, cy); ctx.scale(slap, slap); ctx.translate(-cx, -cy);
  if (plain.length && !TYPESET[cu.text].rev) strike(inkDrum.plate(blk, BLK, { only: plain, key: 'k' }), age, [0, 0]);   // rev: the plain rows stay bare stock
  if (chant.length) strike(inkDrum.plate(blk, RED, { only: chant, key: 'c' }), age, off);
  ctx.restore();
  typeAudit.add(blk, { role: blk.role, read: age >= 0.067 && rise < 2 ? 1 : 0.6, s: slap, dy: rise });
}
window.typeInfo = () => typeAudit.items;
// registration targets, crop marks and the colour bar: the sheet's own furniture
function sheetMarks(m) {
  ctx.save(); ctx.globalCompositeOperation = 'multiply';
  const inks = [[RED, 0, 0], [BLK, m, -m * 0.6], [GOLD, -m * 0.7, m * 0.9]];
  for (const [c, dx, dy] of inks) {
    ctx.strokeStyle = c; ctx.lineWidth = 2;
    for (const [x, y] of [[540, 150], [540, 1860]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, 16, 0, TAU); ctx.moveTo(x + dx - 26, y + dy); ctx.lineTo(x + dx + 26, y + dy); ctx.moveTo(x + dx, y + dy - 26); ctx.lineTo(x + dx, y + dy + 26); ctx.stroke(); }
  }
  ctx.strokeStyle = BLK; ctx.lineWidth = 1.5;
  for (const [x, y, sx, sy] of [[40, 120, 1, 1], [W - 40, 120, -1, 1], [40, H - 40, 1, -1], [W - 40, H - 40, -1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y + sy * 30); ctx.lineTo(x, y + sy * 70); ctx.moveTo(x + sx * 30, y); ctx.lineTo(x + sx * 70, y); ctx.stroke(); }
  const cols = [RED, BLK, GOLD]; let x = 640;
  for (const c of cols) for (const a of [1, 0.6, 0.3]) { ctx.fillStyle = ink(c, a); ctx.fillRect(x, 1845, 26, 26); x += 30; }
  ctx.fillStyle = BLK; ctx.font = '600 14px "Plex Mono"'; ctx.textAlign = 'left'; ctx.fillText('R 15° · K 45° · G 75°   3/C OFFSET', 110, 1864);
  ctx.restore();
}
// the fold: the sheet was folded in thirds for the post
function folds() {
  ctx.save();
  for (const y of [640, 1280]) { const g2 = ctx.createLinearGradient(0, y - 6, 0, y + 6); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(0.45, 'rgba(0,0,0,0.13)'); g2.addColorStop(0.55, 'rgba(255,250,235,0.18)'); g2.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g2; ctx.fillRect(0, y - 6, W, 12); }
  ctx.restore();
}

// ================================================================ frame

// ================================================================ v10: Wall Street directs; the planners; the hand
// the WALL ST frieze cut in stone, as shotExchange does it (stencil caps in the stone's own black, bridges cut across)
function friezeWallSt(fr, pr = 1) {
  const cap = Math.min(170, (fr.y2 - fr.y1) * 0.8), cx = (fr.x1 + fr.x2) / 2;
  if (pr <= 0.5) return;
  ko.fillStyle = PAPER; ko.fillRect(fr.x1 + 20, fr.y1 + 2, fr.x2 - fr.x1 - 40, fr.y2 - fr.y1 - 4);
  const blk = setBlock(stencilF, [{ text: 'WALL ST', cap, max: cap, fill: true, sx: 1.25 }], { role: 'plant', x: cx, y: (fr.y1 + fr.y2) / 2, maxW: fr.x2 - fr.x1 - 90 });
  kk.save(); kk.fillStyle = ink(BLK, 1); for (const G of blk.glyphs) { kk.save(); kk.translate(G.ox, G.oy); kk.fill(G.path); kk.restore(); }
  kk.globalCompositeOperation = 'destination-out'; kk.fillStyle = '#000';
  for (const G of blk.glyphs) kk.fillRect(G.ox + G.bb.x1 - 2, blk.bbox.y1 + cap * 0.47, G.bb.x2 - G.bb.x1 + 4, 7);
  kk.restore();
}
function exchangeGround() {
  const gy = tn.createLinearGradient(0, 0, 0, H); gy.addColorStop(0, T(BLK, 0.85)); gy.addColorStop(0.55, T(GOLD, 0.9)); gy.addColorStop(1, T(BLK, 0.7));
  tn.fillStyle = gy; tn.fillRect(0, 0, W, H);
  over(() => { const g = tn.createRadialGradient(540, 700, 0, 540, 700, 700); g.addColorStop(0, T(PAPER, 0.8)); g.addColorStop(1, T(PAPER, 0)); tn.fillStyle = g; tn.fillRect(0, 0, W, H); });
}
// 8-12 THE ORDERS / COME FROM (the frieze reads WALL ST): the exchange prints low in the frame on the b8 hit, the museum's
// rhyme (two temples under guard), and the orders go OUT from its frieze: black telegraph wires strung to every edge of
// the sheet, a paper pulse running each one on the 8ths. b10 punches in.
function shotOrders(b, t) {
  const age = b - 8, pr = ease.outExpo(clamp(age / 0.2)), punch = ease.outExpo(clamp((b - 10) / 0.25));
  const z = (1 + 0.08 * Math.exp(-age * 6)) * (1 + 0.14 * punch) + age * 0.02, fy = 1780;
  exchangeGround();
  const X = x => 540 + (x - 540) * z, Y = y => fy + (y - fy) * z;
  const fr = templeFront(X(540), Y(1800), 1000 * z, 1180 * z, { tone: T(PAPER, 0.9), keyA: pr, cols: 6, lw: 4, ent: 0.27 });
  const src = [(fr.x1 + fr.x2) / 2, (fr.y1 + fr.y2) / 2], r = rng(808), n = 26, u = ease.inOutCubic(clamp((age - 0.15) / 1.3));
  for (let i = 0; i < n; i++) {
    const side = i % 3, e = side === 0 ? [60 + r() * (W - 120), -60] : side === 1 ? [-60, 80 + r() * 1100] : [W + 60, 80 + r() * 1100];
    const sag = 60 + r() * 160, pts = [];
    for (let k = 0; k <= 24; k++) { const f = k / 24 * u; pts.push([lerp(src[0], e[0], f), lerp(src[1], e[1], f) + Math.sin(Math.PI * f) * sag * 0.4]); }
    strokeRun(kk, pts, 3.2, ink(BLK, 1));
    if (u > 0.2) {   // the order running down the wire: a paper pulse with a gold core, one per 8th
      const q = ((age * 2 + r()) % 1) * u, k = Math.min(23, Math.floor(q * 24)), [px, py] = pts[k];
      ko.beginPath(); ko.arc(px, py, 9, 0, TAU); ko.fill(); sp.fillStyle = ink(GOLD, 1); sp.beginPath(); sp.arc(px, py, 5, 0, TAU); sp.fill();
    }
  }
  friezeWallSt(fr, pr);
  over(() => { const g = tn.createRadialGradient(src[0], src[1], 0, src[0], src[1], 300); g.addColorStop(0, T(GOLD, 1)); g.addColorStop(1, T(GOLD, 0)); tn.fillStyle = g; tn.fillRect(src[0] - 300, src[1] - 300, 600, 600); });
  return { cell: 9, misreg: 1.6 + 8 * Math.exp(-age * 7) + 5 * (b >= 10 ? Math.exp(-(b - 10) * 7) : 0), flash: age < 0.066 ? 0.3 : 0 };
}
// 12-16 PARASITIC RENTS / RISE AT HOME,: the home map at 60% red; over every town a stack of gold coins rises a coin at
// a time on the 8ths (the rent ratchet), and from each stack a thread of Treasury paper runs to one gold point on lower
// Manhattan. Hudson: rent is price over value, income with no counterpart in production (THEORY_CORPUS H2).
const RENT_TOWNS = CITY.filter(([n, st, la, lo]) => lo > -98 && lo < -69 && la > 29 && la < 46.5 && !['New York City', 'Brooklyn', 'Queens', 'Manhattan', 'The Bronx', 'Staten Island'].includes(n)).slice(0, 30);
function coin(x, y, w) {   // a coin on edge-up perspective: the rim and the face
  ko.beginPath(); ko.ellipse(x, y, w / 2 + 2, w * 0.2 + 2, 0, 0, TAU); ko.fill();
  sp.fillStyle = ink(GOLD, 1); sp.beginPath(); sp.ellipse(x, y, w / 2, w * 0.2, 0, 0, TAU); sp.fill();
  kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 1.6; kk.beginPath(); kk.ellipse(x, y, w / 2, w * 0.2, 0, 0, TAU); kk.stroke();
  kk.lineWidth = 0.8; kk.beginPath(); kk.ellipse(x, y - 1, w * 0.34, w * 0.13, 0, 0, TAU); kk.stroke();
}
function shotRents(b, t) {
  const age = b - 12, u = ease.inOutCubic(clamp(age / 4));
  const A = albers(lerp(-84.5, -82.5, u), lerp(39.2, 39.6, u), lerp(2350, 2550, u) * (1 + 0.06 * Math.exp(-age * 5)), 540, 1080);
  usMapBase(A, { night: 0.3, landA: 0.42, labels: 0 });
  const [nx, ny] = A([NYC[0], NYC[1]]), step = Math.floor(clamp((age - 0.25) / 3.3) * 14 + 1e-6);   // coins land on the 8ths
  const thr = ease.inOutCubic(clamp((age - 1.0) / 2.2));
  RENT_TOWNS.forEach(([n, st, la, lo, pop], i) => {
    const [x, y] = A([lo, la]); if (x < 20 || x > W - 20 || y < 200 || y > H - 120) return;
    const cap = 3 + Math.round(Math.log10(pop) * 1.4), k = Math.min(cap, Math.max(0, step - (i % 4))), w = 34 + Math.log10(pop) * 3;
    for (let c = 0; c < k; c++) coin(x, y - c * 9, w);
    if (thr > 0 && k > 0) { const top = [x, y - k * 9], pts = [];
      const e = thr * (1 - ((i * 0.37) % 1) * 0.35);
      for (let q = 0; q <= 16; q++) { const f = q / 16 * e; pts.push([lerp(top[0], nx, f), lerp(top[1], ny, f) - Math.sin(Math.PI * f) * (60 + (i % 5) * 26)]); }
      if (e > 0.02) tbill(pts, 4); }
  });
  { const g = thr, rr = 10 + 22 * g;   // the one gold point on lower Manhattan, as in the globe shot
    over(() => { const gg = tn.createRadialGradient(nx, ny, 0, nx, ny, rr * 6); gg.addColorStop(0, T(GOLD, 1)); gg.addColorStop(0.3, T(GOLD, 0.6 * g)); gg.addColorStop(1, T(GOLD, 0)); tn.fillStyle = gg; tn.fillRect(nx - rr * 6, ny - rr * 6, rr * 12, rr * 12); });
    ko.beginPath(); ko.arc(nx, ny, rr + 4, 0, TAU); ko.fill(); sp.fillStyle = ink(GOLD, 1); sp.beginPath(); sp.arc(nx, ny, rr, 0, TAU); sp.fill();
    kk.strokeStyle = ink(BLK, 1); kk.lineWidth = 3; kk.beginPath(); kk.arc(nx, ny, rr + 8, 0, TAU); kk.stroke();
    if (g > 0.3) { kk.font = '600 22px "Plex Mono"'; kk.textAlign = 'left'; ko.fillRect(nx + rr + 16, ny - 16, 124, 26); kk.fillStyle = ink(BLK, 1); kk.fillText('WALL ST', nx + rr + 22, ny + 3); } }
  return { cell: 9, misreg: 1.6 + 7 * Math.exp(-age * 7) };
}
// 32-36 WE LIVE IN A / PLANNED / ECONOMY, / PLANNED ON / WALL STREET.: the v9 globe (b26.8-29.8 of v9 stretched over
// 3.9 beats): every base's thread goes first to its nearest money centre, then all of them to Wall Street. On b35.9
// the exchange prints (the v9 temple, half a beat), and the hand comes up under it on b36.
function shotPlanned(b, t) {
  if (b < 35.9) return shotGold(26.8 + (b - 32) * 0.76, t, true);   // (the temple waits until PLANNED ON / WALL STREET. is off)
  return shotExchange(b, 28.5 + (b - 35.9), t, false);
}
// 36-40 EXPROPRIATE / THE PLANNERS.: MELTDOWN v8's working hand (empire4.hand.js), printed. It rises into the frame
// under the exchange on b36, open and cupped; the exchange's gold comes down its Treasury threads into the palm
// (b36.6-38.4); on b38.4 the fingers close on it (0.9 beats), the gold in the frieze goes out, light spills between the
// knuckles; b39.5 the one silence: the fist held, the press frozen and shaking. The turn (b40) is its consequence.
const [HMc, hm] = mk(W, H), [HPc, hp] = mk(W, H), [OLc, ol] = mk(W, H), [HRc, hr] = mk(W, H);
const ZC = 5, ZW = Math.ceil(W / ZC), ZH = Math.ceil(H / ZC), ZB = new Float32Array(ZW * ZH);
const HS = new Float32Array(HAND.n * 4);   // screen x, y, depth, lambert
function shotHand(b, t) {
  const age = b - 36, frz = b >= 39.5;
  const bb = 29.0 + Math.min(age, 3.5) * 0.18;                                        // the exchange, already printed
  const ex = shotExchange(b, bb, frz ? 15 : t, false);
  // the frieze's gold, and where it goes
  const z = 1 + 0.1 * Math.exp(-(bb - 28.5) * 6) + (bb - 28.5) * 0.04, fy = 1500, FX = 540, FYc = fy + ((1560 - 1180 * 0.1 - 1180 * (0.69 - 0.27) - 1180 * 0.27 / 2) - fy) * z;
  const rise = ease.outCubic(clamp(age / 0.7)), close = ease.inOutCubic(clamp((b - 38.4) / 0.9)), pose = 2 * close;
  const pour = clamp((b - 36.6) / 1.8), pool = ease.outCubic(clamp((b - 37.0) / 1.0));
  const S = 400 * (1 + 0.05 * age), cx = 540 + 20 * Math.sin(age * 1.3), cy = 1500 + 1150 * (1 - rise) + (frz ? 0 : 6 * Math.sin(t * 5));
  const tilt = lerp(0.3, 0.12, close), roll = lerp(-0.1, 0.02, close), yaw = lerp(0.12, -0.05, close);
  const cT = Math.cos(tilt), sT = Math.sin(tilt), cR = Math.cos(roll), sR = Math.sin(roll), cY = Math.cos(yaw), sY = Math.sin(yaw);
  const rot = (v, o) => {   // yaw (about y), tilt back (about x: fingers lean away, palm up), roll (about z)
    let x = v[0] * cY + v[2] * sY, y = v[1], zz = -v[0] * sY + v[2] * cY;
    const y2 = y * cT - zz * sT, z2 = y * sT + zz * cT; y = y2; zz = z2;
    o[0] = x * cR - y * sR; o[1] = x * sR + y * cR; o[2] = zz; return o;
  };
  const D = 7, OY = 0.55;   // perspective distance (palm widths); the palm's centre sits at the screen anchor
  const proj = (v, o) => { const f = D / (D - v[2]); o[0] = cx + v[0] * S * f; o[1] = cy - (v[1] - OY) * S * f; o[2] = v[2]; return o; };
  const L = nrm([-0.35, 0.75, 0.55]);
  // --- the gold threads from the frieze down into the palm (drawn first: the hand covers their ends)
  const palm = proj(rot([0, 0.5, 0.3], [0, 0, 0]), [0, 0, 0]);
  if (pour > 0) { const r = rng(3636);
    for (let i = 0; i < 9; i++) { const x0 = FX + (r() - 0.5) * 420, e = clamp(pour * 1.3 - i * 0.04), give = close * 0.5, pts = [];
      for (let k = 0; k <= 18; k++) { const f = k / 18 * e; pts.push([lerp(x0, palm[0] + (r() - 0.5) * 30, f) + Math.sin(Math.PI * f) * (i - 4) * 18 * (1 - give), lerp(FYc, palm[1], f)]); r(); }
      if (e > 0.02) tbill(pts, lerp(5, 7, close)); } }
  // the frieze's gold goes out as the hand closes on it
  { const g = 1 - close, rr = 380 * g; if (rr > 4) over(() => { const gg = tn.createRadialGradient(FX, FYc, 0, FX, FYc, rr); gg.addColorStop(0, T(GOLD, 0.9)); gg.addColorStop(1, T(GOLD, 0)); tn.fillStyle = gg; tn.fillRect(FX - rr, FYc - rr, 2 * rr, 2 * rr); }); }
  if (rise <= 0.001) return ex;
  // --- project every point; depth buffer (nearest wins, larger z is nearer the lens)
  ZB.fill(-1e9); const v = [0, 0, 0], w = [0, 0, 0], q = [0, 0, 0], nn = [0, 0, 0];
  for (let i = 0; i < HAND.n; i++) {
    posed(HAND, i, pose, v); rot(v, w); proj(w, q);
    const j = i * 3; for (let k = 0; k < 3; k++) nn[k] = HAND.N0[j + k] + (HAND.N2[j + k] - HAND.N0[j + k]) * close; rot(nn, w);
    const lam = Math.max(0, (w[0] * L[0] + w[1] * L[1] + w[2] * L[2]) / (Math.hypot(w[0], w[1], w[2]) || 1)), facing = w[2];
    HS[i * 4] = q[0]; HS[i * 4 + 1] = q[1]; HS[i * 4 + 2] = q[2]; HS[i * 4 + 3] = HAND.kind[i] === 1 ? 1 : (facing < -0.25 ? -1 : lam);
    if (HAND.kind[i] === 1 || q[0] < 0 || q[0] >= W || q[1] < 0 || q[1] >= H) continue;
    const c = Math.floor(q[1] / ZC) * ZW + Math.floor(q[0] / ZC); if (q[2] > ZB[c]) ZB[c] = q[2];
  }
  const vis = i => { const x = HS[i * 4], y = HS[i * 4 + 1]; if (x < 0 || x >= W || y < 0 || y >= H) return false;
    const c = Math.floor(y / ZC) * ZW + Math.floor(x / ZC); return HS[i * 4 + 2] >= ZB[c] - 0.09; };
  // --- the silhouette (every skin, cuff and nail point as a disc), its paper, its keyline
  const rad = S * 0.04;
  hm.setTransform(1, 0, 0, 1, 0, 0); hm.clearRect(0, 0, W, H); hm.fillStyle = '#000'; hm.beginPath();
  for (let i = 0; i < HAND.n; i++) { if (HAND.kind[i] === 1) continue; const x = HS[i * 4], y = HS[i * 4 + 1]; if (y > H + 40) continue; hm.moveTo(x + rad, y); hm.arc(x, y, rad, 0, TAU); }
  hm.fill();
  for (const c of [kk, sp, ko]) { c.save(); c.globalCompositeOperation = 'destination-out'; c.drawImage(HMc, 0, 0); c.restore(); }   // the hand is in front of everything
  hp.setTransform(1, 0, 0, 1, 0, 0); hp.globalCompositeOperation = 'source-over'; hp.clearRect(0, 0, W, H); hp.drawImage(HMc, 0, 0); hp.globalCompositeOperation = 'source-in'; hp.fillStyle = PAPER; hp.fillRect(0, 0, W, H);
  over(() => { tn.drawImage(HPc, 0, 0); });
  hr.setTransform(1, 0, 0, 1, 0, 0); hr.globalCompositeOperation = 'source-over'; hr.clearRect(0, 0, W, H); hr.drawImage(HMc, 0, 0); hr.globalCompositeOperation = 'source-in'; hr.fillStyle = T(RED, 0.8); hr.fillRect(0, 0, W, H);
  tn.drawImage(HRc, 0, 0);   // the body: one solid pass of the red tone, then modelled by light below
  ol.setTransform(1, 0, 0, 1, 0, 0); ol.globalCompositeOperation = 'source-over'; ol.clearRect(0, 0, W, H);
  for (let k = 0; k < 12; k++) { const a = k * TAU / 12; ol.drawImage(HMc, Math.cos(a) * 3.2, Math.sin(a) * 3.2); }
  ol.globalCompositeOperation = 'destination-out'; ol.drawImage(HMc, 0, 0);
  ol.globalCompositeOperation = 'source-in'; ol.fillStyle = ink(BLK, 1); ol.fillRect(0, 0, W, H);
  kk.drawImage(OLc, 0, 0);
  // --- the body in red tone (four levels, one path each), the cuff in the black's tone
  const lv = [new Path2D(), new Path2D(), new Path2D(), new Path2D()], cuffP = new Path2D(), stip = new Path2D(), nails = new Path2D(), gold = new Path2D();
  const ds = 3.2 * S / 400;
  for (let i = 0; i < HAND.n; i++) {
    const kd = HAND.kind[i], lam = HS[i * 4 + 3], x = HS[i * 4], y = HS[i * 4 + 1];
    if (kd === 1) { if (pool > 0 && vis(i) && HAND.tone[i] < pool) gold.rect(x - 1.8, y - 1.8, 3.6, 3.6); continue; }
    if (lam < 0 || !vis(i)) continue;
    if (kd === 2) { cuffP.rect(x - 2.4, y - 2.4, 4.8, 4.8); if (HAND.tone[i] > lam * 1.1 + 0.25) stip.rect(x - 1.2, y - 1.2, 2.4, 2.4); continue; }
    if (kd === 3) { nails.rect(x - 1.6, y - 1.6, 3.2, 3.2); continue; }
    const shade = 1 - lam;   // 0 lit .. 1 dark: the body is the solid red pass; only the lights and the shadows are marked
    const lvl = lam > 0.9 ? 0 : lam > 0.55 ? -1 : lam > 0.3 ? 2 : 3;
    if (lvl >= 0) lv[lvl].rect(x - ds, y - ds, 2 * ds, 2 * ds);
    if (HAND.tone[i] < shade * shade * 0.9 - 0.08) stip.rect(x - 1.3, y - 1.3, 2.6, 2.6);   // the engraver's stipple, dense in the shadows
  }
  over(() => { tn.fillStyle = T(PAPER, 0.3); tn.fill(lv[0]); });                        // the top lights lift toward the stock
  tn.fillStyle = T(RED, 0.45); tn.fill(lv[2]); tn.fillStyle = T(RED, 0.7); tn.fill(lv[3]);   // the half-tones and shadows deepen the red
  tn.fillStyle = T(BLK, 0.3); tn.fill(lv[3]);
  tn.fillStyle = T(BLK, 0.5); tn.fill(cuffP);
  kk.fillStyle = ink(BLK, 1); kk.fill(stip);
  ko.fillStyle = PAPER; ko.fill(nails);
  // the palm's creases, while it is open
  if (close < 0.6) { kk.strokeStyle = ink(BLK, 1 - close / 0.6); kk.lineWidth = 2.2;
    for (const ln of HAND.crease) { kk.beginPath(); ln.forEach((p0, k) => { rot(p0, w); proj(w, q); k ? kk.lineTo(q[0], q[1]) : kk.moveTo(q[0], q[1]); }); kk.stroke(); } }
  // what the palm holds: gold, then pressed small in the fist
  ko.fillStyle = PAPER; ko.fill(gold); sp.fillStyle = ink(GOLD, 1); sp.fill(gold);
  // light spills between the knuckles as the fingers close (b38.8-39.6)
  const spill = clamp((b - 38.8) / 0.25) * (1 - clamp((b - 39.6) / 0.4));
  if (spill > 0) { const r = rng(39); sp.strokeStyle = ink(GOLD, spill); ko.strokeStyle = PAPER;
    for (let k = 0; k < 14; k++) { const a = -Math.PI / 2 + (r() - 0.5) * 2.2, L0 = S * 0.35, L1 = S * (0.7 + r() * 0.9) * spill;
      const p0 = [palm[0] + Math.cos(a) * L0, palm[1] + Math.sin(a) * L0], p1 = [palm[0] + Math.cos(a) * (L0 + L1), palm[1] + Math.sin(a) * (L0 + L1)];
      ko.lineWidth = 9; ko.beginPath(); ko.moveTo(...p0); ko.lineTo(...p1); ko.stroke(); sp.lineWidth = 5; sp.beginPath(); sp.moveTo(...p0); sp.lineTo(...p1); sp.stroke(); } }
  const shake = frz ? 1.5 + 9 * clamp((b - 39.5) / 0.5) ** 2 : 0;
  return { cell: 9, misreg: 1.6 + (b >= 38.4 && b < 39.4 ? 3 * close * (1 - close) * 4 : 0), shake, freeze: frz, flash: age < 0.05 ? 0.2 : 0 };
}

// v10: [from, to, shot, v9 offset]: a v9 shot runs on its own v9 beats (b - offset), so its timing is unchanged
const V9 = (f, d) => (b, t) => f(b - d, t);
const SHOTS = [[0, 4, shotEurope], [4, 8, shotGallery], [8, 12, shotOrders], [12, 16, shotRents],
  [16, 20, V9((b, t) => shotMillsMap(b, t, false), -4)], [20, 24, V9(shotSoldiers, 4)], [24, 32, V9(shotWorld, 16)],
  [32, 36, shotPlanned], [36, 40, shotHand],
  [40, 42, V9(shotBye, 8)], [42, 44, V9(shotHomeward, 8)], [44, 52, V9(shotPairs, 8)], [52, 54, V9(shotHome, 8)], [54, 56, V9(shotMill, 8)],
  [56, 58, V9(shotHelmet, 8)], [58, 60, V9(shotBridge, 8)], [60, 62, V9(shotRails, 8)], [62, 64, V9(shotPower, 8)], [64, 68, V9(shotHull, 8)],
  [68, 72, V9(shotCivilization, 8)]];
const [Sm, smg] = mk(540, 960);
window.renderFrame = async (t) => {
  const beat = B.beat(t), frame = Math.round(t * 30), t0 = performance.now();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  // one brand card only: the lockup on the beat-72 gong (v9: 64); the render is trimmed 1.4 s after it
  // v8: the lockup is 1.4 s on the piece's red (not the kit's black card); after it the garrison ink pools back onto
  // grey Europe, so the loop runs straight into frame 0.
  const LOCK = 1.4 / B.spb;
  if (beat >= 72 && beat < 72 + LOCK) { lockup(ctx, (beat - 72) * B.spb); finish.apply(ctx, frame, { grain: 0.05, vignette: 0.25 }); return; }
  plates();
  const seam = beat >= 72 + LOCK, sb = seam ? -0.9 + 0.9 * clamp((beat - 72 - LOCK) / Math.max(0.1, 76 - 72 - LOCK)) : beat;
  const shot = seam ? [0, 0, shotEurope] : SHOTS.find(s => beat >= s[0] && beat < s[1]);
  const res = shot[2](sb, t) || {};
  if (res.smear > 0) { smg.clearRect(0, 0, 540, 960); smg.drawImage(S, 0, 0); tn.save(); tn.setTransform(1, 0, 0, 1, 0, 0); tn.globalCompositeOperation = 'source-over';
    for (let k = 1; k <= 6; k++) { tn.globalAlpha = 0.28; tn.drawImage(Sm, -k * 14 * res.smear, 0); } tn.restore();
    for (const c of [kk, sp, ko]) { c.save(); c.globalAlpha = 1 - 0.8 * res.smear; c.globalCompositeOperation = 'destination-in'; c.fillRect(0, 0, W, H); c.restore(); } }
  typeKnock(beat);
  const m = res.misreg ?? 1.6;
  const shk = res.shake || 0, shx = shk * Math.sin(t * 91.7), shy = shk * Math.cos(t * 73.3);
  if (shk) { ctx.save(); ctx.translate(540 + shx, 960 + shy); ctx.scale(1.02, 1.02); ctx.translate(-540, -960); }
  const tp = res.freeze ? 15 : t;   // the frozen press: the plates stop boiling
  pr.render(null, S, [['riso', { inks: [RED, BLK, GOLD], screen: res.cell || 9, angles: [15, 45, 75], misreg: m, uneven: 0.3, contrast: 1.3, amount: 1.08 }]], { t: tp, paper: STOCK, boil: 6 });
  pr.draw(ctx);
  ctx.drawImage(Oc, 0, 0);
  starve(sp, 0.45); starve(kk, 0.3);
  ctx.globalCompositeOperation = 'multiply';
  const jx = Math.sin(Math.floor(tp * 6) * 12.9898) * 0.8, jy = Math.cos(Math.floor(tp * 6) * 78.233) * 0.8;
  ctx.drawImage(Pc, -m * 0.7 + jx, m * 0.9 + jy); ctx.drawImage(Kc, jx * 0.5, jy * 0.5);
  ctx.globalCompositeOperation = 'source-over';
  if (shk) ctx.restore();
  drawType(beat, m);
  sheetMarks(m);
  folds();
  if (res.flash) { ctx.fillStyle = ink(PAPER, res.flash); ctx.fillRect(0, 0, W, H); }
  finish.apply(ctx, frame, { grain: 0.04, vignette: 0.28 });
  if (window.__timing) console.log(`frame b=${beat.toFixed(2)} ${(performance.now() - t0).toFixed(0)}ms`);
};
window.sceneReady = true;
