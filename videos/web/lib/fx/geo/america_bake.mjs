#!/usr/bin/env node
// geo/america_bake: writes america_data.js (Canada places, procedural cell seeds, the lake cut set) for geo/america.js.
// Node only, offline, deterministic: every input is an npm package pinned in videos/web/package.json.
//   node videos/web/lib/fx/geo/america_bake.mjs            regenerate america_data.js
//   node videos/web/lib/fx/geo/america_bake.mjs --check    regenerate in memory and diff byte for byte (exit 1 on any difference)
// Shared constants with america.js (keep in step): the pinned fit K/T (AlbersUsa fitExtent([[40,40],[1040,700]], us-atlas nation)),
// the lake rule (>= 5,000 km2, centroid lat > 40, plus Lake St Clair; never Rainy Lake or Lake of the Woods), the province order
// (sane-topojson subunit ids, sorted) and the St Lawrence channel width CH_W (america.js AM_CHANNEL_W). The seed rules are below (SEED),
// the channel and the place snap under CHANNEL and SNAP.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { geoAlbers, geoAlbersUsa, geoArea, geoBounds, geoCentroid, geoContains, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';

const HERE = fileURLToPath(new URL('.', import.meta.url)), WEB = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(WEB + 'package.json');
const R = p => JSON.parse(fs.readFileSync(WEB + 'node_modules/' + p, 'utf8'));
const ver = p => R(p + '/package.json').version;
const OUT = HERE + 'america_data.js';

// the same integer hash as geo/data.js (copied: data.js imports kit.js, which needs a DOM)
const hash = (a, b = 0) => { let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1); h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h ^= h >>> 13; return ((h >>> 0) % 100000) / 100000; };
const r3 = v => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------- inputs
const K = 1281.155720846112, T = [577.23940528341, 365.2962757577257];
const ct = R('us-atlas/counties-10m.json');
const fit = geoAlbersUsa().fitExtent([[40, 40], [1040, 700]], feature(ct, ct.objects.nation));
if (fit.scale() !== K || fit.translate()[0] !== T[0] || fit.translate()[1] !== T[1]) throw new Error(`america_bake: the AlbersUsa fit moved (${fit.scale()}, ${fit.translate()}); re-pin K/T here and in america.js`);
const C = geoAlbers().scale(K).translate(T);                 // AlbersUsa's lower-48 conic, unclipped: CONUS px are bit-identical
const na = R('sane-topojson/dist/north-america_50m.json');
const provs = feature(na, na.objects.subunits).features.filter(f => f.properties.gu === 'CAN').sort((a, b) => a.id < b.id ? -1 : 1);
const PROVS = provs.map(f => f.id);
if (PROVS.join() !== 'AB,BC,MB,NB,NL,NS,NT,NU,ON,PE,QC,SK,YT') throw new Error('america_bake: province set changed: ' + PROVS);
const PI = Object.fromEntries(PROVS.map((p, i) => [p, i]));

// GeoNames admin1 -> postal (all-the-cities adminCode)
const A1 = { '01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL', '07': 'NS', '08': 'ON', '09': 'PE', '10': 'QC', '11': 'SK', '12': 'YT', '13': 'NT', '14': 'NU' };
// places: the bake_geo.mjs rule (country, population >= 1000, no featureCode filter), sorted by pop desc then name
const cities = require('all-the-cities');
const PLACES0 = cities.filter(c => c.country === 'CA' && c.population >= 1000).map(c => {
  const p = A1[c.adminCode]; if (!p) throw new Error(`america_bake: no province for ${c.name} (${c.adminCode})`);
  return [r3(c.loc.coordinates[0]), r3(c.loc.coordinates[1]), c.population, c.name, p];
}).sort((a, b) => b[2] - a[2] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));

// lakes cut out of Canada: every lake >= 5,000 km2 with centroid lat > 40, plus Lake St Clair (us-atlas cuts it); never Rainy / Woods
const LAKE_NAMES = [['Superior', -87.76, 47.55], ['Huron', -82.26, 44.97], ['Michigan', -86.78, 44.0], ['Erie', -81.25, 42.16], ['Ontario', -77.75, 43.68],
  ['Great Bear', -120.94, 66.02], ['Great Slave', -113.87, 61.77], ['Winnipeg', -97.78, 52.58], ['Athabasca', -109.31, 59.18], ['Reindeer', -102.38, 57.28],
  ['Smallwood', -64.95, 54.18], ['Nettilling', -70.52, 66.51], ['St Clair', -82.70, 42.46]];
const NEVER = [['Rainy', -93.02, 48.63], ['Lake of the Woods', -94.70, 49.30]];
const nameAt = (c, list) => (list.find(([, x, y]) => Math.abs(c[0] - x) < 0.1 && Math.abs(c[1] - y) < 0.1) || [null])[0];
const lakeF = feature(na, na.objects.lakes).features;
const LAKES = [];
lakeF.forEach((f, i) => {
  const km2 = geoArea(f) * 6371 ** 2, ce = geoCentroid(f), name = nameAt(ce, LAKE_NAMES);
  if (nameAt(ce, NEVER)) return;
  if ((km2 >= 5000 && ce[1] > 40) || name === 'St Clair') {
    if (!name) throw new Error(`america_bake: unnamed lake ${i} in the cut set (${ce})`);
    LAKES.push([i, [r3(ce[0]), r3(ce[1])], name, Math.round(km2)]);
  }
});
if (LAKES.length !== LAKE_NAMES.length) throw new Error(`america_bake: lake cut set has ${LAKES.length} lakes, expected ${LAKE_NAMES.length}`);
const cutLakes = LAKES.map(([i]) => lakeF[i]);

// ---------------------------------------------------------------- CHANNEL: the St Lawrence from Lake Ontario to Lake St Francis
// Both datasets hold this stretch as land: the 50m Lake Ontario polygon ends at Brockville, us-atlas fills the US half of the river to
// the line, and NE 10m Canada only opens the river at St Regis (Lake St Francis). america.js cuts a CH_W map-px channel along this
// polyline (the NE 10m US-Canada line from inside the cut Lake Ontario to St Regis, then two points into NE's own water) out of the land.
const CH_W = 0.8, CH_FROM = [-75.844, 44.439], CH_TO = [-74.713, 44.999], CH_TAIL = [[-74.625, 45.031], [-74.561, 45.066]];
const w10 = R('world-atlas/countries-10m.json'), wg = w10.objects.countries.geometries;
const NE_CAN = feature(w10, wg.find(g => g.id === '124'));
const NE_LINE = mesh(w10, { type: 'GeometryCollection', geometries: [wg.find(g => g.id === '124'), wg.find(g => g.id === '840')] }, (a, b) => a !== b).coordinates;
const nearestV = ll => { let best = null, bd = Infinity; NE_LINE.forEach((L, li) => L.forEach((v, vi) => { const d = (v[0] - ll[0]) ** 2 + (v[1] - ll[1]) ** 2; if (d < bd) { bd = d; best = [li, vi]; } })); return [...best, Math.sqrt(bd)]; };
const [la, ia, da] = nearestV(CH_FROM), [lb, ib, db] = nearestV(CH_TO);
if (la !== lb || da > 0.01 || db > 0.01) throw new Error(`america_bake: the channel anchors are not on one NE line (${[la, ia, da, lb, ib, db]})`);
const CHANNEL = NE_LINE[la].slice(Math.min(ia, ib), Math.max(ia, ib) + 1);
if (ia > ib) CHANNEL.reverse();                                   // west to east: Lake Ontario first
CHANNEL.push(...CH_TAIL);
for (let k = 0; k < CHANNEL.length; k++) CHANNEL[k] = [r3(CHANNEL[k][0]), r3(CHANNEL[k][1])];
if (!cutLakes.some(f => geoContains(f, CHANNEL[0]))) throw new Error('america_bake: the channel does not start inside a cut lake');
if (CH_TAIL.some(ll => geoContains(NE_CAN, ll))) throw new Error('america_bake: the channel tail is not in NE water');
const chPx = CHANNEL.map(ll => C(ll));

// ---------------------------------------------------------------- SNAP: places whose point falls in the cut water
// The cut lakes are 1:50M (sane-topojson) against 1:10M land, so a shore town can sit up to ~0.4 map px inside a lake; the channel runs
// past Brockville, Prescott, Morrisburg and Cornwall. A place inside a cut lake, or within CH_W / 2 + SNAP of the channel, moves to the
// nearest point on land in its 50m province that is SNAP map px clear of every cut-lake edge and CH_W / 2 + SNAP clear of the channel:
// the town's light core then sits on land. The row gets a 6th field 'snap'; CA_META.snapped lists every move
// [name, prov, [lon, lat] before, after, 'lake <name>' | 'channel', map px].
const SNAP = 0.25;
const segsOf = rings => rings.flatMap(R0 => R0.slice(1).map((ll, i) => { const a = C(R0[i]), b = C(ll); return [a[0], a[1], b[0], b[1]]; }));
const ringsOf = f => f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
const foot = (p, s) => { const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy, u = l2 ? Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / l2)) : 0; return [s[0] + u * dx, s[1] + u * dy]; };
const nearestOn = (p, segs) => { let bf = null, bd = Infinity, bs = null; for (const s of segs) { const f = foot(p, s), d = Math.hypot(f[0] - p[0], f[1] - p[1]); if (d < bd) { bd = d; bf = f; bs = s; } } return [bf, bd, bs]; };
const chSegs = chPx.slice(1).map((b, i) => [chPx[i][0], chPx[i][1], b[0], b[1]]);
const SNAPPED = [];

// ---------------------------------------------------------------- SEED: procedural cells for Canada (no county data exists there)
// Town sites: places >= 5k, greedily by pop, >= TOWN_MIN map px apart. Fillers: a jittered hex lattice (jitter +-0.35 spacing from hash(i, j)),
// SOUTH px apart below 52N (border-state county size), NORTH px apart above (Alaska borough size). A filler is kept only inside its 50m
// province and outside the cut lakes, and is dropped within 0.6 x spacing of any site already kept (the town sites first, then the southern
// lattice, then the northern one). Over CAP seeds: SOUTH + 1 px and rerun. Every province gets at least one seed.
const TOWN_MIN = 8, NORTH = 30, LAT_SPLIT = 52, CAP = 940;
const pbox = provs.map(f => geoBounds(f));
const inBox = ([lon, lat], b) => lon >= b[0][0] && lon <= b[1][0] && lat >= b[0][1] && lat <= b[1][1];
const provOf = ll => { for (let i = 0; i < provs.length; i++) if (inBox(ll, pbox[i]) && geoContains(provs[i], ll)) return i; return -1; };
const lbox = cutLakes.map(f => geoBounds(f));
const inLake = ll => cutLakes.some((f, i) => inBox(ll, lbox[i]) && geoContains(f, ll));
const onLand = (ll, prov) => { const i = PI[prov]; return inBox(ll, pbox[i]) && geoContains(provs[i], ll) && !inLake(ll); };
const lakeSegs = segsOf(cutLakes.flatMap(ringsOf));
const PLACES = PLACES0.map(p => {
  const ll = [p[0], p[1]], q = C(ll), lk = cutLakes.findIndex((f, i) => inBox(ll, lbox[i]) && geoContains(f, ll));
  const why = lk >= 0 ? 'lake ' + LAKES[lk][2] : nearestOn(q, chSegs)[1] < CH_W / 2 + SNAP ? 'channel' : null;
  if (!why) return p;
  // the nearest point (rings of 48 directions, 0.05 px apart) on land in the place's 50m province, SNAP clear of every cut-lake edge
  // and CH_W / 2 + SNAP clear of the channel
  for (let r = 0.05; r <= 3; r += 0.05) for (let k = 0; k < 48; k++) {
    const g = C.invert([q[0] + r * Math.cos(k * Math.PI / 24), q[1] + r * Math.sin(k * Math.PI / 24)]), nl = [r3(g[0]), r3(g[1])], nq = C(nl);
    if (nearestOn(nq, lakeSegs)[1] < SNAP || nearestOn(nq, chSegs)[1] < CH_W / 2 + SNAP || !onLand(nl, p[4])) continue;
    SNAPPED.push([p[3], p[4], ll, nl, why, r3(Math.hypot(nq[0] - q[0], nq[1] - q[1]))]);
    return [nl[0], nl[1], p[2], p[3], p[4], 'snap'];
  }
  throw new Error(`america_bake: cannot snap ${p[3]} (${why}) to land`);
});
const [[X0, Y0], [X1, Y1]] = geoPath(C).bounds({ type: 'FeatureCollection', features: provs });
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

function seedsFor(SOUTH) {
  const out = [], px = [];
  for (const p of PLACES) {
    if (p[2] < 5000) continue;
    const q = C([p[0], p[1]]);
    if (px.every(s => d2(s, q) >= TOWN_MIN * TOWN_MIN)) { out.push([p[0], p[1], PI[p[4]], 'town']); px.push(q); }
  }
  const lattice = (sp, salt, keep) => {
    for (let j = 0, y = Y0 - sp; y <= Y1 + sp; j++, y += sp * Math.sqrt(3) / 2)
      for (let i = 0, x = X0 - sp + (j % 2) * sp / 2; x <= X1 + sp; i++, x += sp) {
        const jx = x + (hash(i + salt, j) - 0.5) * 0.7 * sp, jy = y + (hash(j + salt + 7777, i) - 0.5) * 0.7 * sp;
        const g = C.invert([jx, jy]); if (!g) continue;
        const ll = [r3(g[0]), r3(g[1])]; if (!keep(ll[1])) continue;
        const q = C(ll), lim = (0.6 * sp) ** 2;
        if (px.some(s => d2(s, q) < lim)) continue;
        const pr = provOf(ll); if (pr < 0 || inLake(ll)) continue;
        out.push([ll[0], ll[1], pr, 'fill']); px.push(q);
      }
  };
  lattice(SOUTH, 0, lat => lat < LAT_SPLIT);
  lattice(NORTH, 50000, lat => lat >= LAT_SPLIT);
  for (let i = 0; i < provs.length; i++) if (!out.some(s => s[2] === i)) { const c = geoCentroid(provs[i]); out.push([r3(c[0]), r3(c[1]), i, 'fill']); }
  return out;
}
let SOUTH = 16, SEEDS = seedsFor(SOUTH);
while (SEEDS.length > CAP) SEEDS = seedsFor(++SOUTH);

// ---------------------------------------------------------------- write
const per = Object.fromEntries(PROVS.map((p, i) => [p, SEEDS.filter(s => s[2] === i).length]));
const META = {
  generator: 'videos/web/lib/fx/geo/america_bake.mjs',
  sources: {
    places: `all-the-cities@${ver('all-the-cities')} (GeoNames cities.pbf): country CA, population >= 1000, no featureCode filter (the bake_geo.mjs rule)`,
    provinces: `sane-topojson@${ver('sane-topojson')} north-america_50m.json objects.subunits (gu CAN)`,
    lakes: `sane-topojson@${ver('sane-topojson')} north-america_50m.json objects.lakes (indices)`,
    canada: `world-atlas@${ver('world-atlas')} countries-10m.json geometry 124 (read at run time by loadAmerica)`,
    fit: `us-atlas@${ver('us-atlas')} counties-10m.json nation, d3-geo@${ver('d3-geo')} geoAlbersUsa().fitExtent([[40,40],[1040,700]])`,
  },
  flags: { places: 'real', seeds: 'procedural' },
  fit: { k: K, t: T },
  seedRule: { townMinPx: TOWN_MIN, southPx: SOUTH, northPx: NORTH, latSplit: LAT_SPLIT, jitter: 0.35, townClear: 0.6, cap: CAP },
  channel: { widthPx: CH_W, from: CH_FROM, to: CH_TO, tail: CH_TAIL, rule: 'the NE 10m US-Canada line from inside the cut Lake Ontario to St Regis, then into Lake St Francis' },
  snap: { px: SNAP, rule: 'a place inside a cut lake, or within CH_W / 2 + SNAP of the channel, moves to the nearest point on land in its 50m province SNAP px clear of the cut-lake edges and CH_W / 2 + SNAP clear of the channel' },
  snapped: SNAPPED,
  counts: { places: PLACES.length, places5k: PLACES.filter(p => p[2] >= 5000).length, seeds: SEEDS.length,
    towns: SEEDS.filter(s => s[3] === 'town').length, fills: SEEDS.filter(s => s[3] === 'fill').length, perProv: per, lakes: LAKES.length, snapped: SNAPPED.length, channel: CHANNEL.length },
};
const rows = a => a.map(r => JSON.stringify(r)).join(',\n');
const text = `// geo/america_data: GENERATED by america_bake.mjs. Do not edit by hand: node videos/web/lib/fx/geo/america_bake.mjs [--check]
// CA_PLACES  [lon, lat, pop, name, prov(, 'snap')]: GeoNames (all-the-cities) places in Canada, pop >= 1000, sorted by pop desc then name.
//            'real'. 'snap': the point fell in a cut lake or the St Lawrence channel and was moved onto land (CA_META.snapped lists each move).
// CA_CHANNEL [lon, lat] polyline: the St Lawrence from inside the cut Lake Ontario to Lake St Francis (america.js cuts it out of the land).
// CA_SEEDS   [lon, lat, provIdx, 'town' | 'fill']: procedural cell sites (Canada has no county data). Never caption cells as real units.
// CA_LAKES   [index into north-america_50m objects.lakes, pinned centroid [lon, lat], name, km2]: the lakes cut out of Canada.
// CA_PROVS   province order for provIdx (sane-topojson subunit ids).
export const CA_META = ${JSON.stringify(META, null, 1)};
export const CA_PROVS = ${JSON.stringify(PROVS)};
export const CA_LAKES = [
${rows(LAKES)},
];
export const CA_PLACES = [
${rows(PLACES)},
];
export const CA_SEEDS = [
${rows(SEEDS)},
];
export const CA_CHANNEL = ${JSON.stringify(CHANNEL)};
`;
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur === text) console.log(`america_bake --check: identical (${text.length} bytes; places ${PLACES.length}, seeds ${SEEDS.length}, south ${SOUTH} px)`);
  else {
    const a = cur.split('\n'), b = text.split('\n'); let i = 0; while (i < a.length && a[i] === b[i]) i++;
    console.log(`america_bake --check: DIFFERS at line ${i + 1}\n  file: ${(a[i] ?? '<eof>').slice(0, 160)}\n  bake: ${(b[i] ?? '<eof>').slice(0, 160)}`); process.exitCode = 1;
  }
} else {
  fs.writeFileSync(OUT, text);
  console.log(`america_bake: wrote ${OUT} (${text.length} bytes): places ${PLACES.length} (${META.counts.places5k} >= 5k, ${SNAPPED.length} snapped), lakes ${LAKES.length}, channel ${CHANNEL.length} pts, seeds ${SEEDS.length} (towns ${META.counts.towns}, fills ${META.counts.fills}, south ${SOUTH} px) ${JSON.stringify(per)}`);
}
