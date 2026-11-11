#!/usr/bin/env node
// geo/america_test: node-only checks for the America layer (no browser, no rendering). Failures set process.exitCode = 1.
//   node videos/web/lib/fx/geo/america_test.mjs
// 1 back-compat (usmap.js byte-identical but for its AMERICA export line; shader hashes; USMap constructor fingerprint; 200 lon/lats vs a
//   fresh geoAlbersUsa fit)  2 projection identity (CONUS + Hawaii counties and towns bit-identical; Alaska moved; known points)
//   3 data (america_data.js counts, order, lakes, seeds; america_bake --check)  4 budget  5 border / coast split  6 assignCells
//   7 _frame semantics  8 draw() through a GL spy  9 towns() with ignite  10 scene_lint over every scene that imports the map code
//   11 the bake recipe through recording canvases (seam / channel / lake cuts), and the seam against the datasets (slivers closed, no sea)
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- DOM stub (kit.js touches document at load)
const ctx2d = new Proxy({}, { get: (t, k) => k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : typeof k === 'string' && /^[a-z]/.test(k) && !['canvas', 'fillStyle', 'strokeStyle', 'font', 'globalAlpha', 'lineWidth', 'filter', 'globalCompositeOperation', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin'].includes(k) ? () => {} : t[k], set: (t, k, v) => (t[k] = v, true) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }), fonts: { load: async () => {}, add() {} }, body: { appendChild() {} }, getElementById: () => null, querySelector: () => null };
globalThis.window = globalThis; globalThis.Path2D = class { constructor(d) { this.d = d || ''; } };
globalThis.Image = class {}; globalThis.FontFace = class { load() { return Promise.resolve(this); } };

const HERE = fileURLToPath(new URL('.', import.meta.url)), WEB = fileURLToPath(new URL('../../../', import.meta.url)), REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const { USMap, US_STYLES, US_FS, US_FS_NRM } = await import('./usmap.js');
const { GLSL_NOISE } = await import('./gl.js');
const A = await import('./america.js');
const { CA_PLACES, CA_SEEDS, CA_LAKES, CA_PROVS, CA_META, CA_CHANNEL } = await import('./america_data.js');
const d3 = await import('d3-geo');
const { feature, mesh } = await import('topojson-client');
const R = p => JSON.parse(fs.readFileSync(WEB + 'node_modules/' + p, 'utf8'));
const ct = R('us-atlas/counties-10m.json'), bake = JSON.parse(fs.readFileSync(WEB + 'assets/geo/us.json', 'utf8'));
const G = { us: { counties: feature(ct, ct.objects.counties).features, states: feature(ct, ct.objects.states).features, nation: feature(ct, ct.objects.nation),
  countyMesh: mesh(ct, ct.objects.counties, (a, b) => a !== b && (a.id / 1000 | 0) === (b.id / 1000 | 0)), stateMesh: mesh(ct, ct.objects.states, (a, b) => a !== b), rivers: null, lakes: null, ...bake } };
const AM = A.buildAmerica(R('world-atlas/countries-10m.json'), R('sane-topojson/dist/north-america_50m.json'));

let nPass = 0, nFail = 0;
const check = (name, ok, detail = '') => { if (ok) nPass++; else { nFail++; process.exitCode = 1; } console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); };
const section = s => console.log(`\n${s}`);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const near = (p, q, tol) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
const HOME = [-94.6, 39.1], HNL = [-157.86, 21.31];
const fips = f => +f.id.slice(0, 2);

// ================================================================ 1. back-compat
section('1. back-compat');
const src = fs.readFileSync(HERE + 'usmap.js', 'utf8');
check('usmap.js minus its AMERICA line is the 26 Sep file', sha(src.split('\n').filter(l => !l.includes('// AMERICA')).join('\n')) === 'b521c7c6d43cbde3c539be421a26d343d25b4c4cbb9b061f6629f06a54e42f0a');
check('usmap.js has exactly one AMERICA line, the last', src.split('\n').filter(l => l.includes('// AMERICA')).length === 1 && src.trimEnd().split('\n').pop().includes('// AMERICA'));
const raw = n => { const i = src.indexOf(`const ${n} = \``) + `const ${n} = \``.length; return src.slice(i, src.indexOf('`;', i)); };
for (const [n, h] of [['FS', 'd1f8352398c00e75'], ['FS_PLATE', '36ac5f73aa436499'], ['FS_NRM', '00e21e1d23ac3fc1']]) check(`shader ${n} sha256 ${h}`, sha(raw(n)).startsWith(h));
check('US_FS === FS (evaluated)', US_FS === raw('FS').replace('${GLSL_NOISE}', GLSL_NOISE));
check('US_FS_NRM === FS_NRM', US_FS_NRM === raw('FS_NRM'));
const finger = us => {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify([us.proj.scale(), us.proj.translate(), us.MAP, us.S]));
  for (const c of us.c) h.update(c.id + ':' + c.x + ',' + c.y + ':' + c.wn + ':' + c.p.d);
  h.update(us.countyMesh.d); h.update(us.stateMesh.d); h.update(us.nation.d); h.update(us.grat.d);
  for (const c of us.cities) h.update(c.x + ',' + c.y + ',' + c.pop);
  return h.digest('hex').slice(0, 16);
};
const us = new USMap(G);
for (const [label, m] of [['new USMap(G)', us], ['new USMap(G, {})', new USMap(G, {})], ['new USMap(G, { bake: 3 })', new USMap(G, { bake: 3 })]])
  check(`${label} fingerprint 1bb59e0e51a97189`, finger(m) === '1bb59e0e51a97189' && m.c.length === 3142 && m.cities.length === 7172 && m.proj.scale() === 1281.155720846112, `${finger(m)} ${m.c.length} ${m.cities.length}`);
// 200 lon/lats: the default map's project() against a fresh AlbersUsa fit (identical numbers, or both null)
const ref = d3.geoAlbersUsa().fitExtent([[40, 40], [1040, 700]], G.us.nation);
const hsh = (i, s) => { let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(s + 7, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296; };
const samples = [];
for (let i = 0; i < 150; i++) samples.push([-125 + 59 * hsh(i, 1), 24.5 + 25 * hsh(i, 2)]);
for (let i = 0; i < 25; i++) samples.push([-168 + 28 * hsh(i, 3), 55 + 15 * hsh(i, 4)]);
for (let i = 0; i < 25; i++) samples.push([-160.3 + 5.5 * hsh(i, 5), 18.9 + 3.4 * hsh(i, 6)]);
let same = 0, nonNull = 0;
for (const ll of samples) { const a = ref(ll), b = us.project(ll); if (a === null ? b === null : (b && a[0] === b[0] && a[1] === b[1])) same++; if (a) nonNull++; }
check('200 sample lon/lats: default USMap.project === fresh geoAlbersUsa fit', same === 200, `${same}/200 identical, ${nonNull} on the map`);

// ================================================================ 2. projection identity
section('2. projection identity');
check('passing `fit` throws', (() => { try { new A.AmericaMap(G, AM, { fit: [[0, 0], [10, 10]] }); return false; } catch { return true; } })());
const am = new A.AmericaMap(G, AM), P = am.proj;
check('pinned fit: k, t', P.scale() === A.AM_K && P.translate()[0] === A.AM_T[0] && P.translate()[1] === A.AM_T[1]);
const dm = new Map(us.c.map(c => [c.id, c]));
let conus = 0, conusSame = 0, hiN = 0, hiSame = 0, ak = 0, akMoved = 0;
for (const c of am.c) {
  const d = dm.get(c.id), eq = !!d && d.x === c.x && d.y === c.y && d.p.d === c.p.d, st = fips(c);
  if (st === 2) { ak++; akMoved += !eq; } else if (st === 15) { hiN++; hiSame += eq; } else { conus++; conusSame += eq; }
}
check('3,108 CONUS counties: x, y, path === default', conus === 3108 && conusSame === 3108, `${conusSame}/${conus}`);
check('5 Hawaii counties (inset): x, y, path === default', hiN === 5 && hiSame === 5, `${hiSame}/${hiN}`);
check('29 Alaska counties moved to the true position', ak === 29 && akMoved === 29);
check('3,142 counties (MELTDOWN / 3,142 stays true)', am.c.length === 3142 && am.c.every((c, i) => c.id === us.c[i].id));
check('no county FIPS > 56', am.c.every(c => fips(c) <= 56));
const terr = G.us.counties.filter(f => fips(f) > 56);
check(`all ${terr.length} territory paths empty`, terr.length === 89 && terr.every(f => !am.path(f)));
let cS = 0, cN = 0, hS = 0, hN = 0, aN = 0, aMoved = 0;
const sameOrder = am.cities.length === us.cities.length && am.cities.every((c, i) => c.name === us.cities[i].name && c.pop === us.cities[i].pop);
check('cities: same 7,172 towns in the same order', sameOrder, `${am.cities.length}`);
if (sameOrder) am.cities.forEach((c, i) => { const d = us.cities[i], eq = c.x === d.x && c.y === d.y;
  if (c.st === 'AK') { aN++; aMoved += !eq; } else if (c.st === 'HI') { hN++; hS += eq; } else { cN++; cS += eq; } });
check('7,097 CONUS towns identical', cN === 7097 && cS === 7097, `${cS}/${cN}`);
check('53 Hawaii towns identical', hN === 53 && hS === 53, `${hS}/${hN}`);
check('22 Alaska towns moved', aN === 22 && aMoved === 22, `${aMoved}/${aN}`);
check('cities stay US-only (no cc CA)', am.cities.every(c => c.cc === 'US') && !am.cities.some(c => c.cc === 'CA'));
const nums = d => (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) || []).map(Number);
const inExt = (x, y) => x >= A.AM_EXT[0][0] - 1e-6 && x <= A.AM_EXT[1][0] + 1e-6 && y >= A.AM_EXT[0][1] - 1e-6 && y <= A.AM_EXT[1][1] + 1e-6;
const pathIn = p2 => { const v = nums(p2.d); for (let i = 0; i + 1 < v.length; i += 2) if (!inExt(v[i], v[i + 1])) return false; return v.length > 0; };
for (const n of ['countyMesh', 'stateMesh', 'nation', 'canada', 'provMesh', 'lakesP', 'coast', 'border', 'borderWater', 'waBorderP']) check(`${n} bounds inside AM_EXT`, pathIn(am[n]));
const KNOWN = { Toronto: [[-79.38, 43.65], [854, 230]], Iqaluit: [[-68.52, 63.75], [903, -219]], Barrow: [[-156.79, 71.29], [7, -497]], Attu: [[173.18, 52.9], [-496, -511]], "St John's": [[-52.71, 47.56], [1223, 19]] };
for (const [n, [ll, xy]] of Object.entries(KNOWN)) { const p = P(ll); check(`${n} at (${xy})`, near(p, xy, 1), p.map(v => v.toFixed(2)).join(', ')); }
check('HOME at (611.67, 356.12)', near(P(HOME), [611.67, 356.12], 0.01) && P(HOME)[0] === us.project(HOME)[0] && P(HOME)[1] === us.project(HOME)[1]);
for (const [n, ll] of [['HOME', HOME], ['Honolulu', HNL]]) { const q = P.invert(P(ll)); check(`P.invert(P(${n})) round-trips`, Math.abs(q[0] - ll[0]) < 1e-6 && Math.abs(q[1] - ll[1]) < 1e-6); }
// the original deliverable's sanity set: inside the extent, in the right order
const C6 = { Anchorage: [-149.9, 61.22], Vancouver: [-123.12, 49.28], Winnipeg: [-97.14, 49.9], Toronto: [-79.38, 43.65], Montreal: [-73.57, 45.5], Halifax: [-63.57, 44.65] };
const p6 = Object.fromEntries(Object.entries(C6).map(([n, ll]) => [n, P(ll)]));
check('Anchorage, Vancouver, Winnipeg, Toronto, Montreal, Halifax inside AM_EXT', Object.values(p6).every(p => inExt(p[0], p[1])));
check('west to east: Anchorage < Vancouver < Winnipeg < Toronto < Montreal < Halifax', ['Anchorage', 'Vancouver', 'Winnipeg', 'Toronto', 'Montreal', 'Halifax'].every((n, i, a) => !i || p6[a[i - 1]][0] < p6[n][0]));
check('north of: Anchorage above Vancouver, Winnipeg and Montreal above Toronto', p6.Anchorage[1] < p6.Vancouver[1] && p6.Winnipeg[1] < p6.Toronto[1] && p6.Montreal[1] < p6.Toronto[1]);
check('Honolulu lands in the Hawaii inset', P.inInset(P(HNL)) && near(P(HNL), us.project(HNL), 0));
const amNH = new A.AmericaMap(G, AM, { hawaii: false });
check('hawaii: false drops FIPS 15 and the HI towns', amNH.c.length === 3137 && !amNH.c.some(c => fips(c) === 15) && amNH.cities.length === 7119 && !amNH.proj.inInset(amNH.proj(HNL)));
check('kmAt: HOME r = 1000 map px is ~4,900 km (great circle)', Math.abs(A.kmAt(HOME, 1000) - 4919) < 15, A.kmAt(HOME, 1000).toFixed(0) + ' km');
// a ring end inside the Hawaii inset box is measured in the conic, not to Hawaii
const gcConic = (r, ang) => { const o = P.conic(HOME); return d3.geoDistance(HOME, P.conic.invert([o[0] + r * Math.cos(ang), o[1] + r * Math.sin(ang)])) * 6371; };
const kmHI = [[400, 2.4], [420, 2.35], [380, 2.5]].map(([r, a]) => [A.kmAt(HOME, r, a), gcConic(r, a), am.kmAt(HOME, r, a), P.inInset([P(HOME)[0] + r * Math.cos(a), P(HOME)[1] + r * Math.sin(a)])]);
check('kmAt: ring ends in the Hawaii inset box measure the conic point (export and method)', kmHI.every(([k, g, m, ins]) => ins && Math.abs(k - g) < 1e-6 && Math.abs(m - g) < 1e-6), kmHI.map(([k, g]) => `${k.toFixed(0)}/${g.toFixed(0)} km`).join(', '));
check('kmAt from Honolulu stays in the inset (round trip r 0)', A.kmAt(HNL, 0) < 1e-6);
for (const [n, b] of Object.entries(A.AM_BOX)) check(`AM_BOX.${n} matches the measured box`, am.box[n] && am.box[n].every((v, i) => Math.abs(v - b[i]) <= 0.5), JSON.stringify(am.box[n]));
const fc = am.frame('continent');
check("frame('continent') ~ {362, 67, .574}", Math.abs(fc.x - 362) < 1 && Math.abs(fc.y - 67) < 1 && Math.abs(fc.zoom - 0.574) < 0.002, JSON.stringify(fc));
// 'south' as documented: keeps Alaska's cities, trims only y < -432 (Alaska's Arctic coast, northern Ellesmere); width-limited in portrait
const inBoxS = ll => { const p = P.conic(ll), b = A.AM_BOX.south; return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]; };
const bS = A.AM_BOX.south, inS = c => c.x >= bS[0] && c.x <= bS[2] && c.y >= bS[1] && c.y <= bS[3];
check("'south' keeps every town (all 22 Alaska towns, all of caCities), Banks I, Victoria I and Baffin I; trims Barrow, Kotzebue, Nome and Alert",
  am.cities.filter(c => c.st === 'AK').length === 22 && am.cities.filter(c => c.st !== 'HI').every(inS) && am.caCities.every(inS) && [[-149.9, 61.22], [-147.72, 64.84], [-122, 71.6], [-110, 68.6], [-77.96, 72.7]].every(inBoxS)
  && ![[-156.79, 71.29], [-162.6, 66.9], [-165.41, 64.5], [-62.3, 82.5]].some(inBoxS));
const zs = n => am.frame(n).zoom, zl = n => am.frame(n, { w: 1920, h: 1080 }).zoom;
check("portrait: 'south' zoom === 'mainland' zoom (width-limited); landscape: 'south' zooms in", Math.abs(zs('south') - zs('mainland')) < 1e-12 && zl('south') > zl('mainland') + 0.05,
  `portrait ${zs('mainland').toFixed(3)}, landscape ${zl('mainland').toFixed(3)} -> ${zl('south').toFixed(3)}`);

// ================================================================ 3. data
section('3. data');
check('1,046 places >= 1k, 478 >= 5k', CA_PLACES.length === 1046 && CA_PLACES.filter(p => p[2] >= 5000).length === 478);
check('13 province codes', CA_PROVS.length === 13 && new Set(CA_PLACES.map(p => p[4])).size === 13 && CA_PLACES.every(p => CA_PROVS.includes(p[4])));
check('13 provinces / territories in AM, each with geometry', AM.provinces.length === 13 && AM.provinces.every(p => p.f && p.f.geometry && d3.geoArea(p.f) > 0 && d3.geoArea(p.f) < 1));
check('border mesh non-empty (3 lines)', AM.waBorder.coordinates.length === 3 && AM.waBorder.coordinates.every(l => l.length > 1), `${AM.waBorder.coordinates.map(l => l.length)}`);
check('Canada coast non-empty', AM.canCoast.coordinates.length > 100);
check('no NaN in places or seeds', CA_PLACES.every(p => [p[0], p[1], p[2]].every(Number.isFinite)) && CA_SEEDS.every(s => Number.isFinite(s[0]) && Number.isFinite(s[1]) && s[2] >= 0 && s[2] < 13));
check('places sorted by pop desc, then name', CA_PLACES.every((p, i) => !i || CA_PLACES[i - 1][2] > p[2] || (CA_PLACES[i - 1][2] === p[2] && CA_PLACES[i - 1][3] <= p[3])));
check('13 cut lakes; pinned centroids within 0.1 deg', AM.lakes.length === 13 && AM.lakes.every(l => { const c = d3.geoCentroid(l.f); return Math.abs(c[0] - l.ce[0]) < 0.1 && Math.abs(c[1] - l.ce[1]) < 0.1; }), AM.lakes.map(l => l.name).join(', '));
check('never Rainy Lake (103) or Lake of the Woods (17)', !CA_LAKES.some(l => l[0] === 103 || l[0] === 17));
const perProv = CA_PROVS.map((_, i) => CA_SEEDS.filter(s => s[2] === i).length);
check('seeds <= 940, every province >= 1', CA_SEEDS.length <= 940 && perProv.every(n => n >= 1), `${CA_SEEDS.length} seeds; ${CA_PROVS.map((p, i) => p + ' ' + perProv[i]).join(', ')}`);
check('cells take every place weight', Math.abs(am.cells.reduce((s, c) => s + c.w, 0) - CA_PLACES.reduce((s, p) => s + p[2], 0)) < 1e-6);
let bakeOut = '', bakeOk = true;
try { bakeOut = execFileSync(process.execPath, [HERE + 'america_bake.mjs', '--check'], { encoding: 'utf8' }).trim(); } catch (e) { bakeOk = false; bakeOut = (e.stdout || '') + (e.stderr || ''); }
check('america_bake.mjs --check: byte-identical', bakeOk && /identical/.test(bakeOut), bakeOut.split('\n')[0]);
check('CA_META counts agree', CA_META.counts.places === 1046 && CA_META.counts.seeds === CA_SEEDS.length);
// water: no place in a cut lake or the channel; every move flagged and listed
const chPx = CA_CHANNEL.map(ll => P.conic(ll)), chSegs = chPx.slice(1).map((b, i) => [chPx[i][0], chPx[i][1], b[0], b[1]]);
const dCh = ll => Math.min(...chSegs.map(sg => A.segDist(P.conic(ll), sg)));
const wet = CA_PLACES.filter(p => AM.lakes.some(l => d3.geoContains(l.f, [p[0], p[1]])) || dCh(p) < A.AM_CHANNEL_W / 2 + 0.2);
check('no Canadian place inside a cut lake or within channel / 2 + 0.2 px of the St Lawrence channel', wet.length === 0, wet.map(p => p[3]).join(', '));
const snapped = CA_PLACES.filter(p => p[5] === 'snap');
check("snapped places flagged 'snap' and listed in CA_META.snapped (each move <= 1 map px)", snapped.length === CA_META.snapped.length && snapped.length > 0 && CA_META.snapped.every(r => r[5] <= 1 && snapped.some(p => p[3] === r[0])),
  `${snapped.length}: ${CA_META.snapped.map(r => r[0] + ' ' + r[5]).join(', ')}`);
check('the six 5k+ towns that sat in the cut lakes moved (Kingston, Niagara Falls, Sault Ste. Marie, Cobourg, Fort Erie, Gananoque)',
  ['Kingston', 'Niagara Falls', 'Sault Ste. Marie', 'Cobourg', 'Fort Erie', 'Gananoque'].every(n => snapped.some(p => p[3] === n && p[2] >= 5000)));
const ontario = AM.lakes.find(l => l.name === 'Ontario').f;
check('CA_CHANNEL: from inside the cut Lake Ontario to NE water at Lake St Francis', CA_CHANNEL.length >= 10 && d3.geoContains(ontario, CA_CHANNEL[0]) && !d3.geoContains(AM.can, CA_CHANNEL[CA_CHANNEL.length - 1]) && !d3.geoContains(G.us.nation, CA_CHANNEL[CA_CHANNEL.length - 1]),
  `${CA_CHANNEL.length} pts, ${CA_CHANNEL[0]} -> ${CA_CHANNEL[CA_CHANNEL.length - 1]}`);

// ================================================================ 4. budget
section('4. budget');
check('nUS + nCells <= 4095', am.R.length <= 4095, `${am.c.length} + ${am.cells.length} = ${am.R.length}`);
check('data texture 16,384 bytes', am.data.length === 16384);
check('cells: numeric ids from 100000, r = hash(id), flagged procedural', am.cells.every((c, j) => c.id === String(100000 + j) && c.kind === 'cell') && AM.flags.cells === 'procedural');

// ================================================================ 5. border
section('5. border / coast');
const sp = am.split, C = P.conic;
check('<= 12 border runs, 1,150-1,300 px', sp.border.length <= 12 && sp.borderPx >= 1150 && sp.borderPx <= 1300, `${sp.border.length} runs, ${sp.borderPx.toFixed(1)} px`);
const closedRun = r => r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
check('no closed ring is all border (Point Roberts is decided per segment)', !sp.border.some(closedRun));
const bv = sp.border.flat();
check("Point Roberts: only its 49th side is border (its sea coast below 48.99N is coast)", bv.some(ll => ll[0] < -123.03 && ll[0] > -123.1 && ll[1] > 48.99) && !bv.some(ll => ll[0] < -123.0 && ll[0] > -123.1 && ll[1] < 48.99));
check('no US Lake Erie island is border (Kelleys, the Bass Islands)', !bv.some(ll => ll[0] > -82.95 && ll[0] < -82.6 && ll[1] > 41.55 && ll[1] < 41.75));
check('border runs end at the coast junctions (Peace Arch: no vertex south of 48.99N on the 49th run)', !bv.some(ll => ll[0] > -122.8 && ll[0] < -122.7 && ll[1] < 48.99));
const bsegs = sp.border.flatMap(r => r.slice(1).map((ll, i) => { const a = C(r[i]), b = C(ll); return [a[0], a[1], b[0], b[1]]; }));
const dRuns = p => Math.min(...bsegs.map(s => A.segDist(p, s)));
for (const ll of [[-110, 49], [-141, 65], [-67.8, 47.1]]) check(`P(${ll}) within 1 px of the border runs`, dRuns(P(ll)) <= 1, dRuns(P(ll)).toFixed(3) + ' px');
const wsegs = AM.waBorder.coordinates.flatMap(l => l.slice(1).map((ll, i) => { const a = C(l[i]), b = C(ll); return [a[0], a[1], b[0], b[1]]; }));
check('every border vertex <= 2 px from the NE border', sp.border.every(r => r.every(ll => { const p = C(ll); return wsegs.some(s => A.segDist(p, s) <= 2); })));
const key = ll => ll[0] + ',' + ll[1];
const bAll = new Set(sp.border.flatMap(r => r.map(key))), bEnds = new Set(sp.border.flatMap(r => [key(r[0]), key(r[r.length - 1])]));
const cInner = sp.coast.flatMap(r => r.slice(1, -1).map(key)), cEnds = sp.coast.flatMap(r => [key(r[0]), key(r[r.length - 1])]);
check('coast and border share only junction vertices', !cInner.some(k => bAll.has(k)) && cEnds.every(k => !bAll.has(k) || bEnds.has(k)));
check('border and borderWater paths drawn', am.border.d.length > 1000 && am.borderWater.d.length > 100);
const inRiv = (a, b) => { const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2; return A.AM_RIVERS.some(r => x >= r[1] && x <= r[3] && y >= r[2] && y <= r[4]); };
const seamSegs = sp.seam.flatMap(r => r.slice(1).map((ll, i) => [r[i], ll]));
const neKeys = new Set(AM.waBorder.coordinates.flatMap(l => l.slice(1).map((ll, i) => key(l[i]) + '|' + key(ll))));
check('seam: NE line segments only, none in a cut lake or an AM_RIVERS section', seamSegs.length > 50 && seamSegs.every(([a, b]) => neKeys.has(key(a) + '|' + key(b)) && !inRiv(a, b) && !AM.lakes.some(l => d3.geoContains(l.f, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]))),
  `${sp.seam.length} runs, ${sp.seamPx.toFixed(0)} px`);
check('water: the line through the St Marys and the Detroit River is water (borderLakes draws it)', sp.water.some(r => r.some(ll => ll[0] > -84.6 && ll[0] < -84.0 && ll[1] > 46.2 && ll[1] < 46.6)) && sp.water.some(r => r.some(ll => ll[0] > -83.2 && ll[0] < -83.0 && ll[1] > 42.0 && ll[1] < 42.3)));

// ================================================================ 6. assignCells
section('6. assignCells (synthetic)');
const chk = k => (k * 97 + 31) & 255;
for (const S of [1, 2]) {
  const ORG = [-40, -30], w = 160 * S, h = 120 * S, D = new Uint8ClampedArray(w * h * 4), PBt = 60000, UNKt = 2, base = 100;
  const put = (i, k) => { D[i] = k & 255; D[i + 1] = k >> 8; D[i + 2] = k ? chk(k) : 0; D[i + 3] = 255; };
  const orig = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const mx = ORG[0] + (x + 0.5) / S, my = ORG[1] + (y + 0.5) / S;
    let k = my > 75 ? 0 : mx < 40 ? PBt : PBt + 1;
    if (mx > 0 && mx < 20 && my > 0 && my < 15) k = PBt + UNKt;           // province unknown
    if (mx > 90 && mx < 110 && my > 40 && my < 60) k = 7;                  // a US county
    orig[y * w + x] = k; put((y * w + x) * 4, k);
  }
  const seeds = [[-30, -20], [20, 40], [70, -10], [100, 70], [-35, 60], [115, 10]], prov = [0, 0, 1, 1, 1, 1];
  const n = A.assignCells(D, w, h, S, ORG, seeds, prov, PBt, UNKt, base);
  const brute = (mx, my, p) => { let b = -1, bd = Infinity; seeds.forEach((s, j) => { if (p >= 0 && prov[j] !== p) return; const d = (s[0] - mx) ** 2 + (s[1] - my) ** 2; if (d < bd) { bd = d; b = j; } }); return b; };
  let bad = 0, untouched = 0, chkBad = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * 4, k = D[i] + D[i + 1] * 256, o = orig[p], mx = ORG[0] + (x + 0.5) / S, my = ORG[1] + (y + 0.5) / S;
    if (o < PBt) { if (k !== o) untouched++; continue; }
    const want = base + brute(mx, my, o - PBt < UNKt ? o - PBt : -1);
    if (k !== want) bad++; if (D[i + 2] !== chk(k)) chkBad++;
  }
  check(`S=${S}: every province pixel takes the nearest seed of its own province; UNK takes any`, bad === 0 && n > 0, `${n} assigned, ${bad} wrong`);
  check(`S=${S}: US and sea pixels untouched; checksums valid`, untouched === 0 && chkBad === 0);
}

// ================================================================ 7. _frame
section('7. _frame');
const nUS = am.c.length, nR = am.R.length;
let f = am._frame({});
check('no ignite: alpha 255 for keys 1..R', Array.from({ length: nR }, (_, i) => f.D[(i + 1) * 4 + 3]).every(a => a === 255) && f.lit === nUS && f.litCA === am.cells.length);
f = am._frame({ ignite: { origin: HOME, r: -1e4, width: 1, heat: 0 } });
check('countryShot ignite (r -1e4): alpha 0 everywhere', Array.from({ length: nR }, (_, i) => f.D[(i + 1) * 4 + 3]).every(a => a === 0) && f.lit === 0 && f.litCA === 0);
const reach = am.reach(HOME);
let mono = true, capped = true, pl = -1, pc = -1;
for (let i = 0; i <= 40; i++) { const g = am._frame({ ignite: { origin: HOME, r: reach * i / 40 } }); if (g.lit < pl || g.litCA < pc) mono = false; if (g.lit > nUS) capped = false; pl = g.lit; pc = g.litCA; }
check('sweep 0..reach(HOME): lit and litCA rise monotonically', mono);
check('lit <= nUS always; full at reach', capped && pl === nUS && pc === am.cells.length, `reach ${reach.toFixed(0)} px: lit ${pl}/${nUS}, litCA ${pc}/${am.cells.length}`);
const D1 = am._frame({ ignite: { origin: [-83.05, 42.33], r: 400 }, t: 3.3 }).D.slice(), D2 = am._frame({ ignite: { origin: [-83.05, 42.33], r: 400 }, t: 3.3 }).D;
check('same inputs give identical D', D1.every((v, i) => v === D2[i]));
const ig400 = { origin: [-83.05, 42.33], r: 400 }, fr = am._frame({ ignite: ig400 });
check('Detroit r 400: the front burns on both sides of the border', fr.front.some(c => c.kind === 'cell') && fr.front.some(c => c.kind !== 'cell'), `front ${fr.front.length}, cells ${fr.front.filter(c => c.kind === 'cell').length}`);

// ================================================================ 8. draw through a GL spy
section('8. draw (GL spy)');
function recCtx(w = 1080, h = 1920) {
  const base = { globalAlpha: 1, lineWidth: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', filter: 'none', lineJoin: 'miter', lineCap: 'butt', font: '' };
  const st = { ...base }, stack = [], log = [];
  const fn = {
    save: () => stack.push({ ...st }), restore: () => Object.assign(st, stack.pop() || base),
    stroke: p => log.push(['stroke', p, st.strokeStyle, st.lineWidth]), getImageData: (x, y, ww, hh) => ({ data: new Uint8ClampedArray(ww * hh * 4) }),
    createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }), measureText: () => ({ width: 10 }),
  };
  return new Proxy(st, {
    get: (t, k) => k === 'canvas' ? { width: w, height: h } : k === 'log' ? log : k in fn ? fn[k] : k in t ? t[k] : typeof k === 'string' ? (...a) => log.push([k, ...a]) : undefined,
    set: (t, k, v) => { t[k] = v; log.push(['set', k, v]); return true; },
  });
}
const spyCalls = [];
const spy = { canvas: { width: 1080, height: 1920 }, gl: {}, resize(w, h) { this.canvas.width = w; this.canvas.height = h; }, tex: () => ({}),
  upload: (t, s) => { spyCalls.push(['upload', s]); return t; }, draw: (...a) => spyCalls.push(['draw', ...a]) };
am.gl = spy; am.ramps = {}; am.tDATA = {}; am.tID = am.tNRM = am.tLINES = am.tAUX = {};
const cam = am.frame('continent'), ctxA = recCtx();
const res = am.draw(ctxA, { cam, style: 'poster', countyLines: 0.5, ignite: { origin: [-83.05, 42.33], r: 300 } });
const dc = spyCalls.filter(c => c[0] === 'draw').pop();
check("program 'us', source === US_FS", dc && dc[1] === 'us' && dc[2] === US_FS);
check('CAMXY = [cam.x + 540, cam.y + 560], MAP = [1800, 1250]', dc && dc[3].CAMXY[0] === cam.x + 540 && dc[3].CAMXY[1] === cam.y + 560 && dc[3].MAP[0] === 1800 && dc[3].MAP[1] === 1250);
check('LC0 alpha scaled by countyLines', dc && Math.abs(dc[3].LC0[3] - US_STYLES.poster.lines[0][3] * 0.5) < 1e-12 && dc[3].LC1[3] === US_STYLES.poster.lines[1][3]);
check('border > 0 (default): stroke(this.border)', ctxA.log.some(l => l[0] === 'stroke' && l[1] === am.border));
check('returns { front, lit, litCA, cells }', res && Number.isFinite(res.lit) && Number.isFinite(res.litCA) && res.cells === am.cells.length && Array.isArray(res.front));
const ctxB = recCtx(); am.draw(ctxB, { cam, style: 'night', border: 0 });
check('border: 0 makes no border stroke', !ctxB.log.some(l => l[0] === 'stroke' && (l[1] === am.border || l[1] === am.borderWater)));
const ctxC = recCtx(); am.draw(ctxC, { cam, style: 'engraving', borderLakes: true });
check('borderLakes: also stroke(this.borderWater)', ctxC.log.some(l => l[0] === 'stroke' && l[1] === am.borderWater));
const ctxD = recCtx(); am.draw(ctxD, { cam, style: 'night', borders: 0 });
check('borders: 0 (MAJORITY) also hides the international line', !ctxD.log.some(l => l[0] === 'stroke' && l[1] === am.border));

// ================================================================ 9. towns
section('9. towns');
const ctxT = recCtx(), igT = { origin: HOME, r: 700 };
am.towns(ctxT, { cam, ignite: igT, minPop: 1, max: 1e9 });
const alphas = ctxT.log.filter(l => l[0] === 'set' && l[1] === 'globalAlpha').map(l => l[2]);
check('towns() with ignite: finite globalAlpha for every entry of allCities', alphas.length > 0 && alphas.every(Number.isFinite) && am.allCities.every(c => am._ign(c, igT).every(Number.isFinite)), `${alphas.length} alpha sets`);
check('allCities = cities + caCities, sorted by pop', am.allCities.length === am.cities.length + am.caCities.length && am.allCities.every((c, i) => !i || am.allCities[i - 1].pop >= c.pop));
check("caCities: 478 places, cc 'CA', with prov", am.caCities.length === 478 && am.caCities.every(c => c.cc === 'CA' && CA_PROVS.includes(c.prov)));
check("the default USMap.towns() keeps its latent NaN (untouched)", Number.isNaN(us._ign(us.cities[0], { origin: HOME, r: 700 })[0]));

// ================================================================ 10. scene_lint
section('10. scene_lint');
const scenes = ['lab_america', 'autopsy', 'majority_a', 'majority', 'majority_b', 'ore', 'lab_maps', 'lab_maps_bench'];
let lint = '', lintOk = true;
try { lint = execFileSync(process.execPath, [REPO + 'videos/tools/scene_lint.mjs', ...scenes], { encoding: 'utf8' }); } catch (e) { lintOk = false; lint = (e.stdout || '') + (e.stderr || ''); }
for (const s of scenes) check(`scene_lint ${s}`, new RegExp(`^${s}: ok`, 'm').test(lint), (lint.match(new RegExp(`^${s}: .*`, 'm')) || ['?'])[0]);
check('scene_lint exit status 0', lintOk);

// ================================================================ 11. the seam against the datasets, and the bake recipe
section('11. seam and bake recipe');
const pip = g => A.pipIndex(g, C), inUSp = pip(G.us.nation), inCAp = pip(AM.can), inLkp = pip({ type: 'FeatureCollection', features: AM.lakes.map(l => l.f) });
const SEG = r => r.slice(1).map((ll, i) => { const a = C(r[i]), b = C(ll); return [a[0], a[1], b[0], b[1]]; });
const seamPx = sp.seam.flatMap(SEG), hw = A.AM_SEAM / 2;
const butt = (p, S) => S.some(s => { const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy; if (!l2) return false; const u = ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / l2; return u >= 0 && u <= 1 && Math.abs((p[0] - s[0]) * dy - (p[1] - s[1]) * dx) / Math.sqrt(l2) <= hw; });
const inChan = p => chSegs.some(sg => A.segDist(p, sg) <= A.AM_CHANNEL_W / 2);
// sea the seam would key as land: points under the butt-capped stroke in neither dataset nor a cut lake, around the line's coastal ends
const SEA = { 'Point Roberts': [-123.06, 48.99], 'Peace Arch': [-122.76, 49.0], Passamaquoddy: [-67.1, 45.1], 'Beaufort at 141W': [-141, 69.6], Hyder: [-130.0, 55.9] };
const fl = Object.fromEntries(Object.entries(SEA).map(([n, ll]) => { const c = C(ll), S = seamPx.filter(s => Math.max(Math.abs(s[0] - c[0]), Math.abs(s[1] - c[1])) < 12); let a = 0;
  for (let y = c[1] - 6; y < c[1] + 6; y += 0.1) for (let x = c[0] - 6; x < c[0] + 6; x += 0.1) { const p = [x, y]; if (inUSp(p) || inCAp(p) || inChan(p)) continue; if (butt(p, S)) a += 0.01; }
  return [n, +a.toFixed(2)]; }));
check('seam keys < 0.2 map px2 of sea as land at each coastal end of the line (was 12.5 at Point Roberts)', Object.values(fl).every(v => v < 0.2), JSON.stringify(fl));
// slivers: points along the land line (outside the cut lakes and AM_RIVERS) in neither dataset, with us-atlas beyond them: covered
let nSl = 0, cSl = 0;
for (const L of AM.waBorder.coordinates) for (let i = 1; i < L.length; i++) {
  if (inRiv(L[i - 1], L[i])) continue; const a = C(L[i - 1]), b = C(L[i]); if (inLkp([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) continue;
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (!l) continue; const nx = -dy / l, ny = dx / l;
  for (let t = 0.05; t < 1; t += 0.1) for (const sg of [1, -1]) for (let d = 0.05; d <= hw; d += 0.1) {
    const q = e => [a[0] + dx * t + nx * sg * e, a[1] + dy * t + ny * sg * e], p = q(d); if (inUSp(p) || (inCAp(p) && !inLkp(p))) continue;
    let bounded = false; for (let e = d + 0.1; e <= d + hw; e += 0.1) if (inUSp(q(e))) { bounded = true; break; }
    if (bounded) { nSl++; if (butt(p, seamPx)) cSl++; } } }
check('seam covers >= 99.9% of the slivers between us-atlas and NE along the land line', nSl > 1000 && cSl / nSl >= 0.999, `${cSl}/${nSl}`);
// the bake recipe: recording 2D canvases, a stub WebGL2 (no pixels); bake 1 keeps it light
{
  const logs = [], doc0 = globalThis.document;
  const rec = () => { const st = { lineCap: 'butt', lineJoin: 'miter', lineWidth: 1, globalCompositeOperation: 'source-over', strokeStyle: '#000', fillStyle: '#000', filter: 'none', globalAlpha: 1 }, stack = [], log = [];
    logs.push(log);
    const fn = { save: () => stack.push({ ...st }), restore: () => Object.assign(st, stack.pop()), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }),
      fill: p => log.push(['fill', p, { ...st }]), stroke: p => log.push(['stroke', p, { ...st }]) };
    return new Proxy(st, { get: (t, k) => k in fn ? fn[k] : k in t ? t[k] : typeof k === 'string' ? () => {} : undefined, set: (t, k, v) => { t[k] = v; return true; } }); };
  const webgl = () => new Proxy({ MAX_TEXTURE_SIZE: 0x0d33, ACTIVE_UNIFORMS: 0x8b86 }, { get: (t, k) => k === 'getParameter' ? q => q === 0x0d33 ? 16384 : 0 : k === 'getProgramParameter' ? (p, q) => q === 0x8b86 ? 0 : true
    : k === 'getShaderParameter' ? () => true : k === 'createTexture' ? () => ({}) : k in t ? t[k] : typeof k === 'string' && /^[A-Z_0-9]+$/.test(k) ? 0 : () => ({}) });
  globalThis.document = { ...doc0, createElement: () => { const c = { width: 300, height: 150, style: {} }; let g; c.getContext = ty => g || (g = ty === 'webgl2' ? webgl() : rec()); return c; } };
  let err = null; const amB = new A.AmericaMap(G, AM, { bake: 1 });
  try { amB._bake(); } catch (e) { err = e; }
  globalThis.document = doc0;
  check('_bake() runs through recording canvases (bake 1)', !err, err ? String(err.message || err) : `${logs.length} 2D canvases`);
  const [mask, idc, , , , , aux] = logs, ops = L => L.map(([op, p, st]) => [op, p === amB.seam ? 'seam' : p === amB.channel ? 'channel' : p === amB.lakesP ? 'lakes' : p === amB.canada ? 'canada' : p === amB.border ? 'border' : p === amB.waBorderP ? 'waBorder' : p === amB.nation ? 'nation' : '?', st]);
  const M = mask ? ops(mask) : [];
  const sStroke = M.find(o => o[0] === 'stroke' && o[1] === 'seam');
  check('mask: seam stroked AM_SEAM wide with butt caps; never the border runs or the whole NE line', !!sStroke && sStroke[2].lineCap === 'butt' && sStroke[2].lineWidth === A.AM_SEAM && !M.some(o => o[0] === 'stroke' && (o[1] === 'border' || o[1] === 'waBorder')));
  check('mask: the cut lakes and the channel (AM_CHANNEL_W, butt) are cut out after the seam', ['lakes', 'channel'].every(n => M.some(o => o[1] === n && o[2].globalCompositeOperation === 'destination-out' && M.indexOf(o) > M.indexOf(sStroke)))
    && M.some(o => o[1] === 'channel' && o[2].lineWidth === A.AM_CHANNEL_W && o[2].lineCap === 'butt'));
  const I = idc ? ops(idc) : [], lastFill = I.map(o => o[0]).lastIndexOf('fill'), chI = I.findIndex(o => o[0] === 'stroke' && o[1] === 'channel');
  check('ID: the channel is stroked as sea (#000) after the last county fill', chI > lastFill && I[chI][2].strokeStyle === '#000');
  const X = aux ? ops(aux) : [], nI = X.findIndex(o => o[0] === 'fill' && o[1] === 'nation'), cI = X.findIndex(o => o[0] === 'stroke' && o[1] === 'channel');
  check('AUX: the channel (#000, source-over) is cut through the nation fill (land = AUX.b)', nI >= 0 && cI > nI && X[cI][2].strokeStyle === '#000' && X[cI][2].globalCompositeOperation === 'source-over');
}

console.log(`\namerica_test: ${nPass} passed, ${nFail} failed`);
