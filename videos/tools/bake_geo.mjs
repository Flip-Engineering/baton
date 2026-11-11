// Bake compact geo data for lib/fx/maps.js from npm datasets (all-the-cities / GeoNames, us-atlas, world-atlas).
//   node tools/bake_geo.mjs      -> web/assets/geo/{us.json, world.json}
// us.json:    cities (pop >= 5k: lon, lat, pop, name, state), county weights (sum of GeoNames place populations
//             inside each county polygon), county centroids, rail corridors (real main lines, routed through
//             the real towns they pass), grid (MST + near-neighbour links over towns >= 10k).
// world.json: cities >= 150k (lon, lat, pop), land dots (equal-area lattice on 50m land), bases.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../web');
const require = createRequire(path.join(WEB, 'package.json'));
const d3 = await import(path.join(WEB, 'node_modules/d3-geo/src/index.js'));
const topo = require('topojson-client');
const cities = require('all-the-cities');
const r2 = x => Math.round(x * 100) / 100;

// ------------------------------------------------------------ US
const usT = require('us-atlas/counties-10m.json');
const counties = topo.feature(usT, usT.objects.counties).features;
const us = cities.filter(c => c.country === 'US' && c.population >= 1000);
const bb = counties.map(f => d3.geoBounds(f));
const weight = {}, cent = {};
for (const f of counties) { weight[f.id] = 0; const c = d3.geoCentroid(f); cent[f.id] = [r2(c[0]), r2(c[1])]; }
let hit = 0;
for (const c of us) {
  const [lon, lat] = c.loc.coordinates;
  for (let i = 0; i < counties.length; i++) {
    const b = bb[i];
    if (lon < b[0][0] || lon > b[1][0] || lat < b[0][1] || lat > b[1][1]) continue;
    if (d3.geoContains(counties[i], [lon, lat])) { weight[counties[i].id] += c.population; hit++; break; }
  }
}
console.log('us places', us.length, 'placed', hit);

const byName = new Map();
for (const c of cities) if (c.country === 'US') {
  const k = c.name + ',' + c.adminCode;
  if (!byName.has(k) || byName.get(k).population < c.population) byName.set(k, c);
}
const MISS = new Set();
const find = k => { const c = byName.get(k); if (!c) { MISS.add(k); return null; } return [r2(c.loc.coordinates[0]), r2(c.loc.coordinates[1])]; };
// real Class I main lines, as the chains of towns they run through
const RAIL = {
  'BNSF Transcon': 'Chicago,IL|Galesburg,IL|Fort Madison,IA|Kansas City,MO|Emporia,KS|Newton,KS|Amarillo,TX|Clovis,NM|Belen,NM|Gallup,NM|Winslow,AZ|Flagstaff,AZ|Kingman,AZ|Needles,CA|Barstow,CA|San Bernardino,CA|Los Angeles,CA',
  'UP Overland': 'Chicago,IL|Clinton,IA|Cedar Rapids,IA|Council Bluffs,IA|Omaha,NE|Grand Island,NE|North Platte,NE|Cheyenne,WY|Laramie,WY|Rawlins,WY|Rock Springs,WY|Evanston,WY|Ogden,UT|Elko,NV|Winnemucca,NV|Reno,NV|Truckee,CA|Sacramento,CA|Oakland,CA',
  'BNSF Northern': 'Chicago,IL|Milwaukee,WI|La Crosse,WI|Saint Paul,MN|Fargo,ND|Minot,ND|Williston,ND|Havre,MT|Shelby,MT|Whitefish,MT|Sandpoint,ID|Spokane,WA|Pasco,WA|Wenatchee,WA|Everett,WA|Seattle,WA',
  'UP Sunset': 'Los Angeles,CA|Colton,CA|Indio,CA|Yuma,AZ|Tucson,AZ|Lordsburg,NM|El Paso,TX|Sanderson,TX|Del Rio,TX|San Antonio,TX|Houston,TX|Beaumont,TX|Lafayette,LA|New Orleans,LA',
  'Cascade': 'Seattle,WA|Tacoma,WA|Portland,OR|Eugene,OR|Klamath Falls,OR|Redding,CA|Sacramento,CA|Stockton,CA|Fresno,CA|Bakersfield,CA|Mojave,CA|Los Angeles,CA',
  'Water Level': 'Chicago,IL|Elkhart,IN|Toledo,OH|Cleveland,OH|Erie,PA|Buffalo,NY|Rochester,NY|Syracuse,NY|Albany,NY|Springfield,MA|Worcester,MA|Boston,MA',
  'Hudson': 'Albany,NY|Poughkeepsie,NY|New York City,NY',
  'Pennsy': 'Chicago,IL|Fort Wayne,IN|Lima,OH|Mansfield,OH|Pittsburgh,PA|Altoona,PA|Harrisburg,PA|Philadelphia,PA|Trenton,NJ|Newark,NJ|New York City,NY',
  'NEC': 'Boston,MA|Providence,RI|New Haven,CT|New York City,NY|Philadelphia,PA|Wilmington,DE|Baltimore,MD|Washington, D.C.,DC|Richmond,VA|Rocky Mount,NC|Florence,SC|Savannah,GA|Jacksonville,FL|Orlando,FL|Miami,FL',
  'Piedmont': 'Washington, D.C.,DC|Lynchburg,VA|Greensboro,NC|Charlotte,NC|Greenville,SC|Atlanta,GA|Birmingham,AL|Meridian,MS|Hattiesburg,MS|New Orleans,LA',
  'Monon': 'Chicago,IL|Indianapolis,IN|Louisville,KY|Nashville,TN|Birmingham,AL|Montgomery,AL|Mobile,AL|New Orleans,LA',
  'Big Four': 'Chicago,IL|Indianapolis,IN|Cincinnati,OH|Huntington,WV|Charleston,WV|Richmond,VA|Norfolk,VA',
  'Southern': 'Cincinnati,OH|Lexington,KY|Chattanooga,TN|Atlanta,GA|Macon,GA|Valdosta,GA|Jacksonville,FL',
  'Katy': 'Chicago,IL|Springfield,IL|St. Louis,MO|Kansas City,MO',
  'Frisco': 'St. Louis,MO|Springfield,MO|Tulsa,OK|Oklahoma City,OK|Wichita Falls,TX|Fort Worth,TX',
  'Texas': 'Kansas City,MO|Parsons,KS|Muskogee,OK|Denison,TX|Dallas,TX|Waco,TX|Temple,TX|Houston,TX',
  'Cotton Belt': 'St. Louis,MO|Poplar Bluff,MO|Little Rock,AR|Texarkana,TX|Dallas,TX|Fort Worth,TX|Abilene,TX|Big Spring,TX|Odessa,TX|El Paso,TX',
  'Memphis': 'Chicago,IL|Champaign,IL|Carbondale,IL|Memphis,TN|Jackson,MS|New Orleans,LA',
  'Memphis-Atlanta': 'Memphis,TN|Corinth,MS|Birmingham,AL|Atlanta,GA',
  'Moffat': 'Omaha,NE|Lincoln,NE|McCook,NE|Denver,CO|Glenwood Springs,CO|Grand Junction,CO|Price,UT|Provo,UT|Salt Lake City,UT|Ogden,UT',
  'Front Range': 'Cheyenne,WY|Denver,CO|Pueblo,CO|Trinidad,CO|Las Vegas,NM|Albuquerque,NM|Belen,NM',
  'Salt Lake Route': 'Salt Lake City,UT|Milford,UT|Las Vegas,NV|Barstow,CA',
  'Hi-Line Spur': 'Spokane,WA|Missoula,MT|Helena,MT|Billings,MT|Sheridan,WY|Casper,WY|Denver,CO',
  'Montana': 'Billings,MT|Glendive,MT|Bismarck,ND|Fargo,ND',
  'KC-Denver': 'Kansas City,MO|Topeka,KS|Salina,KS|Limon,CO|Denver,CO',
  'Pittsburgh-Chicago': 'Pittsburgh,PA|Columbus,OH|Indianapolis,IN|St. Louis,MO',
  'Great Lakes': 'Chicago,IL|Detroit,MI|Toledo,OH',
  'Twin Cities': 'Saint Paul,MN|Des Moines,IA|Kansas City,MO',
  'Gulf': 'Houston,TX|Corpus Christi,TX|Laredo,TX',
  'Tidewater': 'Norfolk,VA|Roanoke,VA|Bristol,TN|Knoxville,TN|Chattanooga,TN|Memphis,TN',
};
const rail = {};
for (const [k, v] of Object.entries(RAIL)) rail[k] = v.split('|').map(find);
if (MISS.size) { console.log('missing', [...MISS]); process.exit(1); }
const railTowns = {};
for (const v of Object.values(RAIL)) for (const n of v.split('|')) railTowns[n.split(',')[0]] = find(n);

// procedural grid over real towns: Euclidean MST (Prim, in an equal-area plane) + second-nearest links for loops
const albers = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
const towns = cities.filter(c => c.country === 'US' && c.population >= 10000).map(c => ({ ll: c.loc.coordinates, p: albers(c.loc.coordinates), pop: c.population }))
  .filter(c => c.p);
const n = towns.length, inT = new Uint8Array(n), best = new Float64Array(n).fill(1e18), par = new Int32Array(n).fill(-1);
const edges = [];
best[0] = 0;
for (let it = 0; it < n; it++) {
  let u = -1; for (let i = 0; i < n; i++) if (!inT[i] && (u < 0 || best[i] < best[u])) u = i;
  inT[u] = 1; if (par[u] >= 0) edges.push([par[u], u]);
  const [ux, uy] = towns[u].p;
  for (let i = 0; i < n; i++) if (!inT[i]) { const d = (towns[i].p[0] - ux) ** 2 + (towns[i].p[1] - uy) ** 2; if (d < best[i]) { best[i] = d; par[i] = u; } }
}
const have = new Set(edges.map(([a, b]) => a < b ? a + ',' + b : b + ',' + a));
for (let i = 0; i < n; i++) {                      // big towns get extra ties to their 2 nearest big neighbours
  if (towns[i].pop < 60000) continue;
  const near = [];
  for (let j = 0; j < n; j++) if (j !== i && towns[j].pop >= 40000) near.push([(towns[j].p[0] - towns[i].p[0]) ** 2 + (towns[j].p[1] - towns[i].p[1]) ** 2, j]);
  near.sort((a, b) => a[0] - b[0]);
  for (const [d, j] of near.slice(0, 3)) { const k = i < j ? i + ',' + j : j + ',' + i; if (!have.has(k) && d < 140 ** 2) { have.add(k); edges.push([i, j]); } }
}
console.log('grid towns', n, 'edges', edges.length);

const usOut = {
  cities: cities.filter(c => c.country === 'US' && c.population >= 5000).map(c => [r2(c.loc.coordinates[0]), r2(c.loc.coordinates[1]), c.population, c.name, c.adminCode]),
  weight, cent, rail, railTowns,
  grid: { towns: towns.map(t => [r2(t.ll[0]), r2(t.ll[1]), t.pop]), edges },
};
fs.writeFileSync(path.join(WEB, 'assets/geo/us.json'), JSON.stringify(usOut));

// ------------------------------------------------------------ world
const landT = require('world-atlas/land-50m.json');
const land = topo.feature(landT, landT.objects.land);
const dots = [];
const STEP = 0.9;                                     // degrees of latitude between rows; columns keep equal spacing on the ground
for (let lat = -58; lat <= 84; lat += STEP) {
  const k = Math.max(1, Math.round(360 / STEP * Math.cos(lat * Math.PI / 180)));
  for (let i = 0; i < k; i++) { const lon = -180 + (i + 0.5) * 360 / k; if (d3.geoContains(land, [lon, lat])) dots.push([r2(lon), r2(lat)]); }
}
console.log('land dots', dots.length);
// US military installations abroad (approximate coordinates; public sources). [name, lon, lat]
const BASES = [
  ['RAMSTEIN', 7.60, 49.44], ['SPANGDAHLEM', 6.69, 49.97], ['GRAFENWÖHR', 11.94, 49.70], ['STUTTGART', 9.09, 48.74], ['WIESBADEN', 8.33, 50.05],
  ['AVIANO', 12.60, 46.03], ['VICENZA', 11.55, 45.55], ['NAPLES', 14.29, 40.88], ['SIGONELLA', 14.92, 37.40], ['ROTA', -6.35, 36.64],
  ['MORÓN', -5.62, 37.17], ['LAKENHEATH', 0.56, 52.41], ['MILDENHALL', 0.49, 52.36], ['INCIRLIK', 35.43, 37.00], ['SOUDA BAY', 24.15, 35.53],
  ['LAJES', -27.09, 38.76], ['KEFLAVIK', -22.60, 63.98], ['PITUFFIK', -68.70, 76.53], ['BONDSTEEL', 21.25, 42.37], ['KOGĂLNICEANU', 28.49, 44.36],
  ['REDZIKOWO', 17.10, 54.48], ['AL UDEID', 51.32, 25.12], ['NSA BAHRAIN', 50.61, 26.21], ['AL DHAFRA', 54.55, 24.25], ['ARIFJAN', 48.10, 28.93],
  ['ALI AL SALEM', 47.52, 29.35], ['PRINCE SULTAN', 47.58, 24.06], ['MUWAFFAQ SALTI', 36.78, 31.83], ['LEMONNIER', 43.15, 11.55], ['DIEGO GARCIA', 72.41, -7.31],
  ['KADENA', 127.77, 26.35], ['FUTENMA', 127.75, 26.27], ['YOKOSUKA', 139.67, 35.29], ['YOKOTA', 139.35, 35.75], ['MISAWA', 141.37, 40.70],
  ['IWAKUNI', 132.24, 34.15], ['SASEBO', 129.72, 33.16], ['HUMPHREYS', 127.03, 36.96], ['OSAN', 127.03, 37.09], ['KUNSAN', 126.62, 35.90],
  ['ANDERSEN', 144.93, 13.58], ['APRA HARBOR', 144.65, 13.44], ['DARWIN', 130.88, -12.41], ['PINE GAP', 133.74, -23.80], ['SEMBAWANG', 103.82, 1.46],
  ['SOTO CANO', -87.62, 14.38], ['GUANTÁNAMO', -75.10, 19.90], ['KWAJALEIN', 167.73, 8.72], ['ERBIL', 43.96, 36.24], ['AL TANF', 38.62, 33.50],
];
const worldOut = {
  cities: cities.filter(c => c.population >= 150000).map(c => [r2(c.loc.coordinates[0]), r2(c.loc.coordinates[1]), c.population]),
  dots, bases: BASES, home: ['PENTAGON', -77.06, 38.87],
};
fs.writeFileSync(path.join(WEB, 'assets/geo/world.json'), JSON.stringify(worldOut));
for (const f of ['us.json', 'world.json']) console.log(f, (fs.statSync(path.join(WEB, 'assets/geo', f)).size / 1024).toFixed(0), 'KB');
