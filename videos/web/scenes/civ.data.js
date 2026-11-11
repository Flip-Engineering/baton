// CIVILIZATION v15 (2 Oct): the one world. Places, the 750 base sites and the arcs, as data.
// Every coordinate is a real place (towns from the baked GeoNames extract, bases from public lists). The 750 is the client's count
// (Vine's 'about 750 sites in about 80 countries'); the full set is a SAMPLE: ~130 named sites at their real coordinates, and the rest placed in
// the clusters the real list has (Germany, Japan, Korea, Italy, the UK, the Gulf) around them, seeded, so it is the same every frame.
import { rng } from './empire5.kit.js';

export const WALLST = { name: 'WALL ST', ll: [-74.0110, 40.7069] };       // 11 Wall St, the exchange; every order is drawn from here

// [name, lon, lat]
export const TOWNS = {
  AKRON: [-81.52, 41.08], DETROIT: [-83.05, 42.33], FLINT: [-83.69, 43.01], TOLEDO: [-83.56, 41.66], GARY: [-87.35, 41.59],
  BUFFALO: [-78.88, 42.89], YOUNGSTOWN: [-80.65, 41.10], CLEVELAND: [-81.70, 41.50], RICHMOND: [-122.35, 37.94],
  'OKLAHOMA CITY': [-97.52, 35.47], DAYTON: [-84.19, 39.76], CHICAGO: [-87.65, 41.85], HOUSTON: [-95.36, 29.76],
  'LOS ANGELES': [-118.24, 34.05], ATLANTA: [-84.39, 33.75], SEATTLE: [-122.33, 47.61], DENVER: [-104.98, 39.74],
  PHOENIX: [-112.07, 33.45], BOSTON: [-71.06, 42.36], MIAMI: [-80.19, 25.77], DALLAS: [-96.81, 32.78], MINNEAPOLIS: [-93.26, 44.98],
  PITTSBURGH: [-80.0, 40.44], 'SAN FRANCISCO': [-122.42, 37.77], PHILADELPHIA: [-75.16, 39.95], 'KANSAS CITY': [-94.58, 39.10],
  NORFOLK: [-76.29, 36.85], 'SAN DIEGO': [-117.16, 32.72], CHARLOTTE: [-80.84, 35.23], PORTLAND: [-122.68, 45.52], 'LAS VEGAS': [-115.14, 36.17],
  MILWAUKEE: [-87.91, 43.04], INDIANAPOLIS: [-86.16, 39.77], 'FORT WAYNE': [-85.13, 41.13], ROCKFORD: [-89.09, 42.27], LORAIN: [-82.18, 41.45],
  // v18: Canada (the works run across the border with no line drawn)
  TORONTO: [-79.38, 43.65], MONTREAL: [-73.57, 45.50], VANCOUVER: [-123.12, 49.28], CALGARY: [-114.07, 51.05], EDMONTON: [-113.49, 53.55],
  OTTAWA: [-75.70, 45.42], WINNIPEG: [-97.14, 49.90], 'QUEBEC CITY': [-71.21, 46.81], HAMILTON: [-79.87, 43.26], HALIFAX: [-63.57, 44.65],
  WINDSOR: [-83.04, 42.31], REGINA: [-104.62, 50.45], SASKATOON: [-106.67, 52.13], 'THUNDER BAY': [-89.25, 48.38], SUDBURY: [-81.0, 46.49],
};
// v18: Canadian cities for the lights (the US list is assets/geo/us.json): [lon, lat, pop, name]
export const CAN_CITIES = [[-79.38, 43.65, 2794000, 'Toronto'], [-73.57, 45.50, 1762000, 'Montreal'], [-114.07, 51.05, 1306000, 'Calgary'], [-75.70, 45.42, 1017000, 'Ottawa'],
  [-113.49, 53.55, 1010000, 'Edmonton'], [-97.14, 49.90, 749000, 'Winnipeg'], [-123.12, 49.28, 662000, 'Vancouver'], [-122.85, 49.19, 568000, 'Surrey'], [-79.87, 43.26, 569000, 'Hamilton'],
  [-71.21, 46.81, 549000, 'Quebec City'], [-79.64, 43.59, 717000, 'Mississauga'], [-79.76, 43.73, 656000, 'Brampton'], [-63.57, 44.65, 439000, 'Halifax'], [-81.25, 42.98, 422000, 'London'],
  [-80.49, 43.45, 256000, 'Kitchener'], [-83.04, 42.31, 229000, 'Windsor'], [-104.62, 50.45, 226000, 'Regina'], [-106.67, 52.13, 266000, 'Saskatoon'], [-123.37, 48.43, 92000, 'Victoria'],
  [-81.0, 46.49, 166000, 'Sudbury'], [-89.25, 48.38, 108000, 'Thunder Bay'], [-52.71, 47.56, 110000, "St. John's"], [-66.06, 45.27, 70000, 'Saint John'], [-64.80, 46.09, 79000, 'Moncton'],
  [-72.55, 46.34, 140000, 'Trois-Rivieres'], [-71.93, 45.40, 172000, 'Sherbrooke'], [-79.25, 43.16, 136000, 'St. Catharines'], [-78.87, 43.90, 166000, 'Oshawa'], [-76.49, 44.23, 132000, 'Kingston'],
  [-119.50, 49.89, 144000, 'Kelowna'], [-122.31, 49.05, 153000, 'Abbotsford'], [-113.81, 52.27, 100000, 'Red Deer'], [-112.84, 49.69, 101000, 'Lethbridge'], [-122.76, 53.92, 74000, 'Prince George'],
  [-110.68, 50.04, 63000, 'Medicine Hat'], [-105.53, 50.39, 33000, 'Moose Jaw'], [-99.95, 49.85, 49000, 'Brandon'], [-63.13, 46.24, 38000, 'Charlottetown'], [-135.06, 60.72, 28000, 'Whitehorse'],
  [-114.37, 62.45, 20000, 'Yellowknife'], [-68.52, 63.75, 7700, 'Iqaluit'], [-111.38, 56.73, 68000, 'Fort McMurray'], [-117.0, 55.17, 63000, 'Grande Prairie'], [-79.46, 46.31, 51000, 'North Bay']];
// v18 (Hudson, Super Imperialism): the central banks the bases' dollars pile up in, and come back from as bonds. [name, lon, lat]
export const CBANKS = [['FRANKFURT', 8.68, 50.11], ['TOKYO', 139.69, 35.69], ['BEIJING', 116.40, 39.90], ['RIYADH', 46.72, 24.71], ['LONDON', -0.09, 51.51],
  ['SEOUL', 126.98, 37.57], ['ABU DHABI', 54.37, 24.45], ['ZURICH', 8.54, 47.37], ['TAIPEI', 121.56, 25.03], ['SINGAPORE', 103.85, 1.29]];
// the plants that leave (the Great Lakes), and where they go: real manufacturing destinations
export const PLANTS = [
  { town: 'AKRON', to: 'SHENZHEN', toll: [114.06, 22.54] },
  { town: 'DETROIT', to: 'CHONGQING', toll: [106.55, 29.56] },
  { town: 'FLINT', to: 'SUZHOU', toll: [120.62, 31.30] },
  { town: 'TOLEDO', to: 'DHAKA', toll: [90.41, 23.81] },
  { town: 'GARY', to: 'DONGGUAN', toll: [113.75, 23.02] },
  { town: 'BUFFALO', to: 'HANOI', toll: [105.85, 21.03] },
  { town: 'YOUNGSTOWN', to: 'SAIGON', toll: [106.7, 10.78] },
];
// the four pairs: base -> home town, in the order they land
export const PAIRS = [
  { base: 'AVIANO', bll: [12.60, 46.03], town: 'AKRON' },
  { base: 'RAMSTEIN', bll: [7.60, 49.44], town: 'RICHMOND' },
  { base: 'BAHRAIN', bll: [50.60, 26.20], town: 'BUFFALO' },
  { base: 'OKINAWA', bll: [127.77, 26.35], town: 'OKLAHOMA CITY' },
];
// the ten metros whose rents run to Wall St
export const METROS = ['LOS ANGELES', 'CHICAGO', 'HOUSTON', 'PHOENIX', 'ATLANTA', 'SEATTLE', 'DENVER', 'MINNEAPOLIS', 'MIAMI', 'DALLAS', 'SAN FRANCISCO', 'BOSTON', 'PHILADELPHIA', 'KANSAS CITY', 'PORTLAND', 'LAS VEGAS', 'SAN DIEGO', 'CHARLOTTE'];

// named sites [name, lon, lat, cluster]
const NAMED = [
  ['RAMSTEIN', 7.60, 49.44, 'DE'], ['SPANGDAHLEM', 6.69, 49.97, 'DE'], ['GRAFENWOHR', 11.94, 49.70, 'DE'], ['STUTTGART', 9.09, 48.74, 'DE'], ['WIESBADEN', 8.33, 50.05, 'DE'],
  ['BAUMHOLDER', 7.30, 49.65, 'DE'], ['HOHENFELS', 11.84, 49.22, 'DE'], ['VILSECK', 11.80, 49.61, 'DE'], ['ANSBACH', 10.58, 49.30, 'DE'], ['LANDSTUHL', 7.57, 49.41, 'DE'],
  ['HEIDELBERG', 8.69, 49.40, 'DE'], ['KAISERSLAUTERN', 7.77, 49.44, 'DE'], ['ILLESHEIM', 10.40, 49.50, 'DE'],
  ['AVIANO', 12.60, 46.03, 'IT'], ['VICENZA', 11.55, 45.55, 'IT'], ['NAPLES', 14.27, 40.85, 'IT'], ['SIGONELLA', 14.92, 37.40, 'IT'], ['GHEDI', 10.27, 45.43, 'IT'], ['LIVORNO', 10.35, 43.63, 'IT'], ['GAETA', 13.57, 41.20, 'IT'],
  ['LAKENHEATH', 0.56, 52.41, 'UK'], ['MILDENHALL', 0.48, 52.36, 'UK'], ['ALCONBURY', 0.22, 52.37, 'UK'], ['FAIRFORD', -1.79, 51.68, 'UK'], ['MENWITH HILL', -1.69, 54.01, 'UK'], ['CROUGHTON', -1.20, 51.99, 'UK'],
  ['ROTA', -6.35, 36.64, 'ES'], ['MORON', -5.62, 37.17, 'ES'], ['LAJES', -27.09, 38.76, 'PT'], ['CHIEVRES', 3.83, 50.58, 'BE'], ['SHAPE', 3.99, 50.50, 'BE'], ['BRUNSSUM', 5.97, 50.94, 'NL'],
  ['SOUDA BAY', 24.15, 35.49, 'GR'], ['INCIRLIK', 35.43, 37.00, 'TR'], ['IZMIR', 27.15, 38.40, 'TR'], ['KURECIK', 37.80, 38.30, 'TR'],
  ['KOGALNICEANU', 28.49, 44.36, 'RO'], ['DEVESELU', 24.40, 44.10, 'RO'], ['REDZIKOWO', 17.10, 54.48, 'PL'], ['POWIDZ', 17.85, 52.38, 'PL'], ['BONDSTEEL', 21.25, 42.37, 'XK'], ['NOVO SELO', 26.10, 42.17, 'BG'],
  ['PAPA', 17.50, 47.36, 'HU'], ['KEFLAVIK', -22.60, 63.97, 'IS'], ['PITUFFIK', -68.70, 76.53, 'GL'],
  ['AL UDEID', 51.31, 25.12, 'GULF'], ['BAHRAIN', 50.60, 26.20, 'GULF'], ['AL DHAFRA', 54.55, 24.25, 'GULF'], ['ARIFJAN', 48.10, 29.10, 'GULF'], ['ALI AL SALEM', 47.52, 29.35, 'GULF'],
  ['PRINCE SULTAN', 47.58, 24.06, 'GULF'], ['MUWAFFAQ SALTI', 36.78, 31.83, 'ME'], ['LEMONNIER', 43.15, 11.55, 'AF'], ['ERBIL', 43.96, 36.20, 'ME'], ['AL TANF', 38.66, 33.50, 'ME'], ['AIN AL ASAD', 42.44, 33.80, 'ME'],
  ['DUQM', 57.60, 19.50, 'GULF'], ['DIEGO GARCIA', 72.40, -7.30, 'IO'],
  ['KADENA', 127.77, 26.35, 'JP'], ['FUTENMA', 127.76, 26.28, 'JP'], ['YOKOSUKA', 139.67, 35.28, 'JP'], ['YOKOTA', 139.35, 35.75, 'JP'], ['MISAWA', 141.37, 40.70, 'JP'], ['IWAKUNI', 132.24, 34.14, 'JP'],
  ['SASEBO', 129.72, 33.16, 'JP'], ['ZAMA', 139.40, 35.50, 'JP'],
  ['HUMPHREYS', 127.03, 36.96, 'KR'], ['OSAN', 127.03, 37.09, 'KR'], ['KUNSAN', 126.62, 35.90, 'KR'], ['DAEGU', 128.60, 35.84, 'KR'],
  ['ANDERSEN', 144.92, 13.58, 'GU'], ['APRA HARBOR', 144.65, 13.44, 'GU'], ['KWAJALEIN', 167.70, 8.72, 'PAC'], ['DARWIN', 130.88, -12.43, 'AU'], ['PINE GAP', 133.74, -23.80, 'AU'],
  ['SEMBAWANG', 103.82, 1.46, 'SEA'], ['U-TAPAO', 101.00, 12.68, 'SEA'], ['BASA', 120.49, 14.99, 'PH'], ['MAGSAYSAY', 121.00, 15.40, 'PH'], ['LAL-LO', 121.70, 18.20, 'PH'], ['MACTAN', 123.97, 10.30, 'PH'],
  ['SOTO CANO', -87.62, 14.38, 'LA'], ['GUANTANAMO', -75.10, 19.90, 'CAR'], ['COMALAPA', -89.06, 13.44, 'LA'], ['CURACAO', -68.96, 12.20, 'CAR'], ['MANDA BAY', 40.90, -2.25, 'AF'],
  ['ASCENSION', -14.39, -7.97, 'AF'], ['ENTEBBE', 32.40, 0.04, 'AF'],
];
// how many sites each cluster holds in the full 750, and its spread (degrees)
const CLUSTERS = { DE: [172, 0.55], JP: [112, 0.9], KR: [74, 0.35], IT: [40, 0.8], UK: [32, 0.6], GULF: [38, 0.6], ES: [8, 0.4], TR: [8, 0.6], GR: [5, 0.4], ME: [20, 1.2], BE: [10, 0.3], NL: [8, 0.3], PL: [10, 0.9],
  RO: [6, 0.5], GU: [14, 0.1], PH: [10, 0.9], SEA: [8, 2], AF: [10, 3], LA: [10, 2], CAR: [6, 2], PAC: [8, 3], AU: [8, 2], IO: [4, 1], PT: [3, 0.2], IS: [2, 0.1], GL: [2, 0.1], HU: [2, 0.3], BG: [4, 0.4], XK: [2, 0.1] };

function buildSites() {
  const R = rng(1945), out = NAMED.map(([name, lon, lat, cl]) => ({ name, ll: [lon, lat], cl, real: true }));
  const by = {}; for (const s of out) (by[s.cl] ||= []).push(s);
  const gauss = () => (R() + R() + R() + R() - 2) * 1.2;
  for (const [cl, [n, sp]] of Object.entries(CLUSTERS)) {
    const seeds = by[cl] || []; if (!seeds.length) continue;
    let have = seeds.length;
    while (have < n && out.length < 750) {
      const s = seeds[Math.floor(R() * seeds.length)];
      out.push({ name: '', ll: [s.ll[0] + gauss() * sp / Math.max(0.4, Math.cos(s.ll[1] * Math.PI / 180)), s.ll[1] + gauss() * sp], cl, real: false }); have++;
    }
  }
  const all = Object.keys(CLUSTERS).filter(c => by[c]);
  while (out.length < 750) {                                   // top up from the biggest clusters' tails
    const cl = all[Math.floor(R() * R() * all.length)], s = by[cl][Math.floor(R() * by[cl].length)], sp = CLUSTERS[cl][1];
    out.push({ name: '', ll: [s.ll[0] + gauss() * sp, s.ll[1] + gauss() * sp], cl, real: false });
  }
  out.length = 750;
  out.forEach((s, i) => { s.i = i; s.h = R(); });
  return out;
}
export const SITES = buildSites();
export const SITE = Object.fromEntries(SITES.filter(s => s.name).map(s => [s.name, s]));
// the hook's garrison: the named European sites plus a thin cluster scatter, so frame 0 says 'garrison' at a glance
export const EUROPE_SITES = SITES.filter(s => ['DE', 'IT', 'UK', 'ES', 'PT', 'BE', 'NL', 'GR', 'TR', 'RO', 'PL', 'XK', 'BG', 'HU', 'IS'].includes(s.cl) && (s.real || s.h < 0.28));
export const ARRIVAL = [42.2, 44.2, 46.2, 48.2];          // the song's four arrival notes (empire_c17.py)
