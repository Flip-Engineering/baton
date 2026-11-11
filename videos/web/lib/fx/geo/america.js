// geo/america: the America map layer. AMERICA = the USA and Canada together (the party's territory: acp-constitution.txt L1,
// "today's United States of America and Canada"; L17 excludes colonies and territories). Opt-in: scenes import AmericaMap from here;
// every existing `new USMap(geo)` is untouched (usmap.js only gained one export line).
//
//   import { loadGeo } from '../lib/fx/geo/data.js';
//   import { loadAmerica, AmericaMap, kmAt } from '../lib/fx/geo/america.js';
//   const geo = await loadGeo({ world: false, rivers: false }), AM = await loadAmerica();
//   const us = new AmericaMap(geo, AM);            // { bake: 2, hawaii: true, lightScale: 1 }; the fit is pinned (no `fit`)
//   us._bake(); us.plate({ Print });               // plate defaults here: scale 1.4, pitchPx 5 (keep scale <= 2.2)
//   us.draw(ctx, { cam: us.frame('continent'), style: 'night', ignite: { origin: HOME, r: us.reach(HOME) * u }, border: 0 });
//   us.towns(ctx, { cam, which: 'all' | 'us' | 'ca' }); us.ring(ctx, { cam, ignite, km: kmAt(HOME, ignite.r) });
//
// PROJECTION geoAmerica(k, t): AlbersUsa's own lower-48 conic at the default fit, unclipped by AlbersUsa's boxes and clipped instead to
// AM_EXT (which drops Hawaii's true position and PR / VI / GU / MP / AS), plus AlbersUsa's Hawaii inset verbatim. So every CONUS county
// path, centroid and town is bit-identical to the default map (cams, HOME, rail, grid and kmPerPx carry over); Alaska sits at its true
// position (x -503..146, y -529..-75) and Canada is in the same map space. Map space is offset: ORG [-540,-560], MAP [1800,1250].
// Albers is equal-area, not equidistant: any km label comes from kmAt().
//
// CANADA has no county data. It is filled with procedural cells (america_data.js CA_SEEDS: town sites + a jittered lattice, flagged
// 'procedural'): they carry ignition, light and relief like counties, but never caption them and never draw their edges. `lit` counts US
// counties only (MELTDOWN's '/ 3,142' stays true); `litCA` counts cells. us.cities stays US-only; Canadian towns are us.caCities
// (GeoNames, 'real'), the union is us.allCities.
// WATER: Canada's Great Lakes shores are 1:50M (sane-topojson lakes cut out of NE 10m land; no 10m lake set is installed), the US shores
// us-atlas 1:10M. The St Lawrence from Lake Ontario to Lake St Francis is land in both datasets, so the bake cuts an AM_CHANNEL_W channel
// along CA_CHANNEL out of the mask, ID and AUX.b. Canadian places that fell in a cut lake or the channel are moved onto land by the bake
// (CA_PLACES 'snap', CA_META.snapped). The seam (borderSplit) closes the slivers between us-atlas and NE without filling rivers or sea.
//
// BAKE: the USMap recipe translated by ORG (a copy, kept in step by hand). Shared with usmap.js _bake(): the ID colour
// rgb(k & 255, k >> 8, (k * 97 + 31) & 255) with 0 = sea and a 3-pass 4-neighbour fringe repair; HGT grey 40 + 150 wn^1.8, blur 15 px, town
// mounds r = 5 + sqrt(pop) * 0.018, a = min(.42, sqrt(pop) / 2200) for pop >= 20k, blur 3 px; LINES r county 0.45 / g state 1.0 /
// b coast 1.5 map px ('lighter', mip); AUX b land, r rivers 0.7, g town cores rc = 0.35 + 0.28 k; LITE glow rg = 1.6 + 1.1 k
// (k = sqrt(pop / 5000)); NRM = US_FS_NRM. The shaders are usmap.js's own (US_FS, US_FS_NRM): no new GLSL.
import { geoAlbers, geoConicEqualArea, geoPath, geoGraticule, geoDistance } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import { clamp, lerp, ease } from '../../kit.js';
import { hash, camApply, TAU } from './data.js';
import { GL } from './gl.js';
import { USMap, US_STYLES, US_FS, US_FS_NRM } from './usmap.js';
import { CA_PLACES, CA_SEEDS, CA_LAKES, CA_PROVS, CA_META, CA_CHANNEL } from './america_data.js';

// ---------------------------------------------------------------- constants
export const AM_K = 1281.155720846112, AM_T = [577.23940528341, 365.2962757577257];   // AlbersUsa().fitExtent([[40,40],[1040,700]], nation)
export const AM_ORG = [-540, -560], AM_MAP = [1800, 1250];
export const AM_EXT = [[AM_ORG[0], AM_ORG[1]], [AM_ORG[0] + AM_MAP[0], AM_ORG[1] + AM_MAP[1]]];   // [[-540,-560],[1260,690]]
// frame boxes [x0, y0, x1, y1] in map px, from the projected outlines (us-atlas nation + NE 10m Canada); pinned from the first node run,
// re-measured by america_test.mjs. continent: everything; mainland: lon in (-170, 0) (no Aleutian tail); conusCanada: no Alaska, no
// Hawaii inset; conus: the lower 48. south: the mainland vertices below 62N. It does NOT crop the Arctic islands: Albers parallels curve
// upward away from 96W, so its top (y -432, Alaska's Bering coast at 61.8N) runs at 81.7N on the central meridian; it trims only Alaska's
// north-west (Barrow, Kotzebue, Nome: no us.cities town) and Ellesmere north of 77-81N (Alert), and 92.5% of the Arctic islands' area stays
// inside. No rectangle crops the islands and keeps Alaska: Banks, Victoria and Baffin sit level with Anchorage (y -305) and Fairbanks
// (-350). Every preset is wider than tall, so in portrait (1080x1920) all are width-limited and 'south' has 'mainland''s zoom (.632,
// centre 49 px lower); it zooms in only in landscape (1920x1080: .908 against .834). A vertical frame zooms in only through a
// horizontal crop.
export const AM_BOX = {
  continent: [-502.97, -529.44, 1227, 662.5],
  mainland: [-345.36, -529.44, 1227, 662.5],
  south: [-345.36, -432.31, 1227, 662.5],
  conusCanada: [53.49, -493.24, 1227, 662.5],
  conus: [115.01, 77.5, 1040, 662.5],
};
export const PROV_NAMES = { AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia',
  NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon' };
// the bake's seam stroke (map px) along the NE line where us-atlas leaves a sliver, and the St Lawrence channel (america_bake.mjs CH_W)
export const AM_SEAM = 2.6, AM_CHANNEL_W = 0.8;
// NE line sections that run in a river or a lake chain: never seam-stroked (us-atlas holds parts of them as water). [name, lon0, lat0, lon1, lat1]
export const AM_RIVERS = [['St Marys', -84.8, 45.9, -83.4, 46.6], ['St Clair', -82.56, 42.55, -82.38, 43.06], ['Detroit', -83.2, 42.0, -82.9, 42.36],
  ['Niagara', -79.1, 42.85, -78.88, 43.28], ['St Lawrence', -76.5, 43.9, -74.6, 45.03], ['St Croix and Chiputneticook', -67.85, 45.0, -66.9, 45.96]];
const PB = 60000, UNK = CA_PROVS.length;                     // bake-time ID keys: PB + province index; PB + UNK = Canadian land, province unknown
const chk = k => (k * 97 + 31) & 255;
const keyCSS = k => `rgb(${k & 255},${k >> 8},${chk(k)})`;

// ---------------------------------------------------------------- projection
// d3 does not export albersUsa's multiplex: one stream fanned out to several
function multiplex(s) {
  const n = s.length;
  return {
    point(x, y) { for (let i = 0; i < n; i++) s[i].point(x, y); }, sphere() { for (let i = 0; i < n; i++) s[i].sphere(); },
    lineStart() { for (let i = 0; i < n; i++) s[i].lineStart(); }, lineEnd() { for (let i = 0; i < n; i++) s[i].lineEnd(); },
    polygonStart() { for (let i = 0; i < n; i++) s[i].polygonStart(); }, polygonEnd() { for (let i = 0; i < n; i++) s[i].polygonEnd(); },
  };
}
// k, t: the AlbersUsa fit. The point function is total (never null): the Hawaii box goes through the inset, everything else the conic.
export function geoAmerica(k, t, { hawaii = true } = {}) {
  const x = +t[0], y = +t[1], e = 1e-6;
  const conic = geoAlbers().scale(k).translate([x, y]);                 // AlbersUsa's lower-48 conic (seam at 84E: the Aleutians stay whole)
  const clipped = geoAlbers().scale(k).translate([x, y]).clipExtent(AM_EXT);
  const hi = geoConicEqualArea().rotate([157, 0]).center([-3, 19.9]).parallels([8, 18]).scale(k).translate([x - 0.205 * k, y + 0.212 * k])
    .clipExtent([[x - 0.214 * k + e, y + 0.166 * k + e], [x - 0.115 * k - e, y + 0.234 * k - e]]);   // AlbersUsa's Hawaii inset, verbatim
  const box = hi.clipExtent();
  const isHI = ll => hawaii && ll[0] > -179 && ll[0] < -154 && ll[1] > 18 && ll[1] < 29;
  const inInset = p => hawaii && p[0] >= box[0][0] && p[0] <= box[1][0] && p[1] >= box[0][1] && p[1] <= box[1][1];
  const P = ll => (isHI(ll) ? hi : conic)(ll);
  P.invert = p => (inInset(p) ? hi : conic).invert(p);
  P.stream = s => hawaii ? multiplex([clipped.stream(s), hi.stream(s)]) : clipped.stream(s);
  P.scale = () => k; P.translate = () => [x, y];
  return Object.assign(P, { conic, clipped, hi, hawaii, isHI, inInset, inset: box, extent: AM_EXT });
}
const P0 = geoAmerica(AM_K, AM_T);
// great-circle km of a map-px radius r from origin [lon, lat], measured along screen angle ang (the ring label's angle). The ring end is
// inverted in the origin's own projection (the conic, or the Hawaii inset for a Hawaii origin): P.invert is multiplexed, and an end point
// that lands in the inset box would otherwise be measured to Hawaii.
export function kmAt(origin, r, ang = -0.6, P = P0) {
  const o = P(origin), inv = P.conic ? (P.isHI(origin) ? P.hi : P.conic).invert : P.invert;
  const q = inv([o[0] + r * Math.cos(ang), o[1] + r * Math.sin(ang)]);
  return geoDistance(origin, q) * 6371;
}

// ---------------------------------------------------------------- data
// detail '10m' matches us-atlas's 1:10M. Module-relative URLs: works from any scene directory.
export async function loadAmerica({ detail = '10m', rivers = false } = {}) {
  const get = async p => (await fetch(new URL('../../../node_modules/' + p, import.meta.url))).json();
  const [w, na] = await Promise.all([get(`world-atlas/countries-${detail}.json`), get('sane-topojson/dist/north-america_50m.json')]);
  return buildAmerica(w, na, { rivers });
}
// the same, pure (node passes parsed JSON): w = world-atlas countries topology, na = sane-topojson north-america_50m
export function buildAmerica(w, na, { rivers = false } = {}) {
  const geoms = w.objects.countries.geometries, gc = geoms.find(g => g.id === '124'), gu = geoms.find(g => g.id === '840');
  if (!gc || !gu) throw new Error('america: world-atlas has no Canada (124) or USA (840)');
  const GC = { type: 'GeometryCollection', geometries: [gc, gu] };
  const subs = new Map(na.objects.subunits.geometries.filter(g => g.properties && g.properties.gu === 'CAN').map(g => [g.id, g]));
  if (CA_PROVS.some(p => !subs.has(p))) throw new Error('america: north-america_50m is missing a province');
  return {
    can: feature(w, gc),                                                    // NE admin-0 Canada: includes its half of the Great Lakes (cut below)
    waBorder: mesh(w, GC, (a, b) => a !== b),                               // the NE US-Canada land line (it runs through the lakes)
    canCoast: mesh(w, GC, (a, b) => a === b && a.id === '124'),             // Canada's sea coast
    provinces: CA_PROVS.map(id => ({ id, name: PROV_NAMES[id], f: feature(na, subs.get(id)) })),
    provMesh: mesh(na, { type: 'GeometryCollection', geometries: CA_PROVS.map(id => subs.get(id)) }, (a, b) => a !== b),
    lakes: CA_LAKES.map(([i, ce, name, km2]) => ({ i, ce, name, km2, f: feature(na, na.objects.lakes.geometries[i]) })),
    rivers: rivers ? feature(na, na.objects.rivers) : null,
    channel: CA_CHANNEL, places: CA_PLACES, seeds: CA_SEEDS, provs: CA_PROVS, meta: CA_META,
    flags: { cells: 'procedural', cellWeight: 'sample', caTowns: 'real', canada: 'real' },
  };
}

// ---------------------------------------------------------------- border / coast split (conic px)
const lines = g => g.type === 'FeatureCollection' ? g.features.flatMap(f => lines(f.geometry)) : g.type === 'Feature' ? lines(g.geometry)
  : g.type === 'MultiPolygon' ? g.coordinates.flat() : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
const polysOf = g => g.type === 'FeatureCollection' ? g.features.flatMap(f => polysOf(f.geometry)) : g.type === 'Feature' ? polysOf(g.geometry)
  : g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
function segGrid(polys, proj, tol, cell) {                  // every segment, registered in the cell-px buckets its bbox (+ tol) touches
  const grid = new Map(), segs = [];
  for (const L of polys) {
    let a = proj(L[0]);
    for (let i = 1; i < L.length; i++) {
      const b = proj(L[i]), s = segs.length; segs.push([a[0], a[1], b[0], b[1]]);
      const x0 = Math.floor((Math.min(a[0], b[0]) - tol) / cell), x1 = Math.floor((Math.max(a[0], b[0]) + tol) / cell);
      const y0 = Math.floor((Math.min(a[1], b[1]) - tol) / cell), y1 = Math.floor((Math.max(a[1], b[1]) + tol) / cell);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = x * 100003 + y; const l = grid.get(k); l ? l.push(s) : grid.set(k, [s]); }
      a = b;
    }
  }
  return { grid, segs, cell };
}
export function segDist(p, s) {
  const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
  const u = l2 ? clamp(((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / l2) : 0;
  return Math.hypot(p[0] - s[0] - u * dx, p[1] - s[1] - u * dy);
}
const nearGrid = (G, p, tol) => { const l = G.grid.get(Math.floor(p[0] / G.cell) * 100003 + Math.floor(p[1] / G.cell)); if (l) for (const s of l) if (segDist(p, G.segs[s]) <= tol) return true; return false; };
// planar even-odd point-in-polygon over the projected rings of a (Multi)Polygon / Feature / FeatureCollection, indexed by cell-px strips
export function pipIndex(g, proj, cell = 4) {
  const strips = new Map();
  for (const poly of polysOf(g)) for (const R of poly) {
    let a = proj(R[0]);
    for (let i = 1; i < R.length; i++) {
      const b = proj(R[i]);
      if (a[1] !== b[1]) { const e = [a[0], a[1], b[0], b[1]];
        for (let k = Math.floor(Math.min(a[1], b[1]) / cell), k1 = Math.floor(Math.max(a[1], b[1]) / cell); k <= k1; k++) { const l = strips.get(k); l ? l.push(e) : strips.set(k, [e]); } }
      a = b;
    }
  }
  return p => { const l = strips.get(Math.floor(p[1] / cell)); if (!l) return false; let c = false;
    for (const e of l) if ((e[1] > p[1]) !== (e[3] > p[1]) && p[0] < e[0] + (p[1] - e[1]) * (e[2] - e[0]) / (e[3] - e[1])) c = !c; return c; };
}
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
// Split the us-atlas outline into the land border with Canada and the coast, per segment (conic px). Returns lon/lat runs (draw them
// through the map's own path). Inputs: lakes = the cut lakes (FeatureCollection), can = NE Canada; without them only proximity counts.
//   border: the US outline segments whose both ends lie within tol px of the NE line's land part (its segments outside the cut lakes)
//           and that face Canada: one of the probes 0.25, 0.6, 1, 1.5 and 2 px out from the segment's middle, away from US land, lands
//           in NE Canada outside the cut lakes. A ring whose every segment is near the line (Point Roberts, an islet) is decided segment
//           by segment by that probe; a longer run loses the end segments that face water (the coast at Peace Arch, the Beaufort Sea,
//           Passamaquoddy). So US lake islands near the line and an exclave's sea coast stay coast. Without `can` there is no probe and
//           a ring is never border as a whole.
//   coast:  the complement (includes the US-Mexico line, as the default nation stroke does). Runs meet the border runs at shared vertices.
//   water:  the NE line where it is lake (a segment inside a cut lake) or has an end farther than tol from the US outline: the line
//           through the Great Lakes, the St Marys and the Detroit River (borderLakes draws it)
//   seam:   the NE land segments outside AM_RIVERS where us-atlas leaves a sliver: a probe walking out from the line on the US side, up
//           to AM_SEAM / 2 px, meets neither dataset and then us-atlas land. With one land neighbour on each side. The bake strokes
//           these AM_SEAM wide (butt caps): it closes the slivers and never reaches into the sea at the line's coastal ends.
export function borderSplit(usNation, waBorder, conic, { tol = 2, cell = 4, lakes = null, can = null, rivers = AM_RIVERS } = {}) {
  const inLk = lakes ? pipIndex(lakes, conic) : () => false;
  const inCA = can ? pipIndex(can, conic) : null, inUS = can ? pipIndex(usNation, conic) : null;
  const caLand = p => inCA(p) && !inLk(p);
  const NE = lines(waBorder).map(L => { const P = L.map(ll => conic(ll)); return { L, P, lake: P.slice(1).map((b, i) => inLk(mid(P[i], b))) }; });
  const WA = segGrid(NE.flatMap(({ L, lake }) => lake.flatMap((w, i) => w ? [] : [[L[i], L[i + 1]]])), conic, tol, cell);
  const US = segGrid(lines(usNation), conic, tol, cell);
  const PROBE = [0.25, 0.6, 1, 1.5, 2].filter(d => d <= tol);
  const border = [], coast = [], water = [], seam = [];
  for (const poly of polysOf(usNation)) poly.forEach((R0, ri) => {
    const R = R0.slice(0, -1), n = R.length, pts = R.map(ll => conic(ll)), f = pts.map(p => nearGrid(WA, p, tol));
    const sg = f.map((v, i) => v && f[(i + 1) % n]);                // segment i: R[i] -> R[i + 1]
    if (inCA && sg.includes(true)) {
      let A = 0; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; A += a[0] * b[1] - b[0] * a[1]; }
      const o = (A > 0 ? -1 : 1) * (ri ? -1 : 1);                   // times the left normal (-dy, dx): away from US land
      const faces = i => { const a = pts[i], b = pts[(i + 1) % n], m = mid(a, b), dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        return PROBE.some(d => caLand([m[0] - dy / l * o * d, m[1] + dx / l * o * d])); };
      if (!sg.includes(false)) for (let i = 0; i < n; i++) sg[i] = faces(i);
      else {
        let z = 0; while (sg[z]) z++;
        for (let k = 1; k <= n; k++) { const i = (z + k) % n; if (!sg[i] || sg[(i - 1 + n) % n]) continue;
          const run = []; for (let j = i; sg[j % n] && run.length < n; j++) run.push(j % n);
          while (run.length && !faces(run[0])) sg[run.shift()] = false;
          while (run.length && !faces(run[run.length - 1])) sg[run.pop()] = false; }
      }
    }
    if (!sg.includes(true)) { coast.push([...R, R[0]]); return; }
    if (!sg.includes(false)) { (inCA ? border : coast).push([...R, R[0]]); return; }   // with the probe: an enclave
    let z = 0; while (sg[(z - 1 + n) % n] === sg[z]) z++;           // start where the type changes
    for (let k = 0; k < n;) { const v = sg[(z + k) % n], run = [R[(z + k) % n]];
      while (k < n && sg[(z + k) % n] === v) { k++; run.push(R[(z + k) % n]); }
      (v ? border : coast).push(run); }
  });
  const runsOf = (L, keep, out) => { let run = null; for (let i = 0; i < keep.length; i++) { if (keep[i]) { if (!run) { run = [L[i]]; out.push(run); } run.push(L[i + 1]); } else run = null; } };
  const inRiver = (a, b) => { const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2; return rivers.some(r => x >= r[1] && x <= r[3] && y >= r[2] && y <= r[4]); };
  const cls = p => inUS(p) ? 'U' : caLand(p) ? 'C' : 'N';
  const sliver = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, m = mid(a, b);
    for (const sd of [1, -1]) { if (inCA([m[0] + nx * sd * 0.05, m[1] + ny * sd * 0.05])) continue;   // the US side (Canada's edge is the line)
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) { let seenN = false;
        for (let d = 0.05; d <= AM_SEAM / 2 + 0.01; d += 0.1) { const c = cls([a[0] + dx * t + nx * sd * d, a[1] + dy * t + ny * sd * d]);
          if (c === 'N') seenN = true; else if (c === 'U') { if (seenN) return true; break; } } } }
    return false;
  };
  for (const { L, P, lake } of NE) {
    const far = P.map(p => !nearGrid(US, p, tol));
    runsOf(L, lake.map((w, i) => w || far[i] || far[i + 1]), water);
    if (!inCA) continue;
    const land = lake.map((w, i) => !w && !inRiver(L[i], L[i + 1])), sl = land.map((v, i) => v && sliver(P[i], P[i + 1]));
    runsOf(L, land.map((v, i) => v && (sl[i] || !!sl[i - 1] || !!sl[i + 1])), seam);
  }
  const len = R => { let s = 0, a = conic(R[0]); for (let i = 1; i < R.length; i++) { const b = conic(R[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); a = b; } return s; };
  return { border, coast, water, seam, borderPx: border.reduce((s, R) => s + len(R), 0), seamPx: seam.reduce((s, R) => s + len(R), 0) };
}

// ---------------------------------------------------------------- cells (pure: node-tested)
// D: RGBA ID pixels (w x h at scale S, origin ORG). Pixels keyed PB + p take the key base + j of the nearest seed of province p; PB + UNK
// pixels (and any province without seeds) take the nearest seed of any province. Exact, ties to the lower j: each 32 map-px bucket keeps
// the seeds within r* + 32 sqrt(2) of its centre (r* = the centre's nearest-seed distance), which always holds the nearest seed of every
// point in the bucket. Checksums are rewritten; other keys are untouched. Returns the number of pixels assigned.
export function assignCells(D, w, h, S, ORG, seedsPx, seedProv, PB_, UNK_, base) {
  const B = 32, nbx = Math.ceil(w / S / B) + 1, nby = Math.ceil(h / S / B) + 1, grids = [], has = [];
  for (let p = 0; p <= UNK_; p++) { grids.push(new Array(nbx * nby)); has.push(false); }
  const bOf = (v, o, n) => clamp(Math.floor((v - o) / B), 0, n - 1);
  seedsPx.forEach(([x, y], j) => { const k = bOf(y, ORG[1], nby) * nbx + bOf(x, ORG[0], nbx);
    for (const p of [seedProv[j], UNK_]) if (grids[p]) { (grids[p][k] || (grids[p][k] = [])).push(j); has[p] = true; } });
  const d2 = (j, x, y) => (seedsPx[j][0] - x) ** 2 + (seedsPx[j][1] - y) ** 2;
  const within = (g, bx, by, cx, cy, rad) => {                // every seed of grid g within rad of (cx, cy), in index order
    const out = [], n = Math.ceil(rad / B) + 1;
    for (let yy = Math.max(0, by - n); yy <= Math.min(nby - 1, by + n); yy++) for (let xx = Math.max(0, bx - n); xx <= Math.min(nbx - 1, bx + n); xx++) {
      const L = g[yy * nbx + xx]; if (L) for (const j of L) if (d2(j, cx, cy) <= rad * rad) out.push(j); }
    return out.sort((a, b) => a - b);
  };
  const nearestR = (g, bx, by, cx, cy) => {                   // distance from (cx, cy) to the nearest seed of g (ring search)
    let bd = Infinity;
    for (let r = 0, R = Math.max(nbx, nby); r <= R; r++) {
      for (let yy = by - r; yy <= by + r; yy++) { if (yy < 0 || yy >= nby) continue; const edge = yy === by - r || yy === by + r;
        for (let xx = bx - r; xx <= bx + r; xx += edge ? 1 : 2 * r || 1) { if (xx < 0 || xx >= nbx) continue;
          const L = g[yy * nbx + xx]; if (L) for (const j of L) bd = Math.min(bd, d2(j, cx, cy)); } }
      if (bd <= (r * B) ** 2) break;
    }
    return Math.sqrt(bd);
  };
  const cache = new Map();
  const cands = (p, bx, by) => {
    const key = (by * nbx + bx) * (UNK_ + 1) + p; let c = cache.get(key); if (c) return c;
    const cx = ORG[0] + (bx + 0.5) * B, cy = ORG[1] + (by + 0.5) * B;
    c = within(grids[p], bx, by, cx, cy, nearestR(grids[p], bx, by, cx, cy) + B * Math.SQRT2 + 1e-9); cache.set(key, c); return c;
  };
  let n = 0;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const k = D[i] + D[i + 1] * 256; if (k < PB_ || k > PB_ + UNK_) continue;
    let pr = k - PB_; if (pr >= UNK_ || !has[pr]) pr = UNK_;
    let best = -1;
    if (has[pr]) {
      const mx = ORG[0] + ((p % w) + 0.5) / S, my = ORG[1] + (Math.floor(p / w) + 0.5) / S;
      const L = cands(pr, Math.floor((mx - ORG[0]) / B), Math.floor((my - ORG[1]) / B)); let bd = Infinity;
      for (const j of L) { const d = d2(j, mx, my); if (d < bd) { bd = d; best = j; } }
    }
    const nk = best < 0 ? 0 : base + best; D[i] = nk & 255; D[i + 1] = nk >> 8; D[i + 2] = nk ? chk(nk) : 0; n++;
  }
  return n;
}

// ---------------------------------------------------------------- the map
export class AmericaMap extends USMap {
  constructor(G, AM, opts = {}) {
    if (opts && 'fit' in opts) throw new Error('AmericaMap: the fit is pinned to the USMap default (no `fit` option)');
    const { bake = 2, hawaii = true, lightScale = 1 } = opts || {};
    const u = G.us;
    super({ us: { ...u, counties: [], cities: [], countyMesh: u.nation, stateMesh: u.nation, rivers: null } }, {});   // the base only fits here
    this.G = u; this.AM = AM; this.hawaii = hawaii; this.lightScale = lightScale; this.flags = AM.flags;
    const k = this.proj.scale(), t = this.proj.translate();
    const P = this.proj = geoAmerica(k, t, { hawaii });
    const path = this.path = geoPath(P), pathC = this.pathC = geoPath(P.clipped);
    const maxW = Math.max(...Object.values(u.weight));
    // US counties: the default fields and order; states 1-56 only (no territories), Hawaii only with the inset
    this.c = u.counties.filter(f => { const st = +f.id.slice(0, 2); return st <= 56 && (hawaii || st !== 15); }).map(f => {
      const d = path(f); if (!d) return null;
      const b = path.bounds(f), ce = u.cent[f.id] ? P(u.cent[f.id]) : path.centroid(f);
      const w = u.weight[f.id] || 0;
      return { id: f.id, f, p: new Path2D(d), x: ce[0], y: ce[1], b, w, wn: w > 0 ? clamp(Math.log10(w) / Math.log10(maxW)) : 0, r: hash(+f.id) };
    }).filter(Boolean);
    // Canadian cells (procedural): weight = the GeoNames places whose nearest same-province seed this is (the raster's own rule)
    const seeds = AM.seeds, sp = seeds.map(s => P([s[0], s[1]])), byProv = CA_PROVS.map(() => []);
    seeds.forEach((s, j) => byProv[s[2]].push(j));
    const W = new Float64Array(seeds.length);
    for (const pl of AM.places) {
      const q = P([pl[0], pl[1]]), list = byProv[CA_PROVS.indexOf(pl[4])] || []; let best = -1, bd = Infinity;
      for (const j of list) { const d = (sp[j][0] - q[0]) ** 2 + (sp[j][1] - q[1]) ** 2; if (d < bd) { bd = d; best = j; } }
      if (best >= 0) W[best] += pl[2];
    }
    this.cells = seeds.map((s, j) => ({ id: String(100000 + j), kind: 'cell', prov: CA_PROVS[s[2]], provIdx: s[2], site: s[3], x: sp[j][0], y: sp[j][1],
      w: W[j], wn: W[j] > 0 ? clamp(Math.log10(W[j]) / Math.log10(maxW)) : 0, r: hash(100000 + j) }));
    this.R = [...this.c, ...this.cells];
    if (this.R.length > 4095) throw new Error(`AmericaMap: ${this.R.length} regions do not fit the 64x64 data texture (4095)`);
    // towns: us.cities stays US-only (AUTOPSY's per-state loop cannot mint provinces); every entry carries r and wn (towns() with ignite)
    const town = (lon, lat, pop, name, st, cc, prov) => {
      const p = P([lon, lat]);
      if (P.isHI([lon, lat]) ? !P.inInset(p) : !(p[0] >= AM_EXT[0][0] && p[0] <= AM_EXT[1][0] && p[1] >= AM_EXT[0][1] && p[1] <= AM_EXT[1][1])) return null;
      const o = { x: p[0], y: p[1], pop, name, st, lon, lat, cc, r: hash(lon * 100, lat * 100), wn: 0 }; if (prov) o.prov = prov; return o;
    };
    const byPop = (a, b) => b.pop - a.pop;
    this.cities = u.cities.map(([lon, lat, pop, name, st]) => town(lon, lat, pop, name, st, 'US')).filter(Boolean).sort(byPop);
    this.caCities = AM.places.filter(p => p[2] >= 5000).map(([lon, lat, pop, name, prov]) => town(lon, lat, pop, name, null, 'CA', prov)).filter(Boolean).sort(byPop);
    this.allCities = [...this.cities, ...this.caCities].sort(byPop);
    this.pop = this.cities.reduce((s, c) => s + c.pop, 0); this.popCA = this.caCities.reduce((s, c) => s + c.pop, 0);
    // map space
    this.ORG = AM_ORG.slice(); this.MAP = AM_MAP.slice(); this.S = bake; this.view = [1080, 1920];
    this.data = new Uint8Array(64 * 64 * 4);
    // paths (the multiplexed path for US data; the plain clipped conic for Canada / NE data)
    const P2 = d => new Path2D(d || '');
    this.countyMesh = P2(path(u.countyMesh)); this.stateMesh = P2(path(u.stateMesh)); this.nation = P2(path(u.nation));
    this.rivers = u.rivers ? P2(path(u.rivers)) : null;
    this.riversCA = AM.rivers ? P2(pathC(AM.rivers)) : null;                 // stroked inside Canada only (NE rivers repeat the US ones)
    this.canada = P2(pathC(AM.can));
    this.provinces = AM.provinces.map(p => ({ id: p.id, name: p.name, p: P2(pathC(p.f)) }));
    this.provMesh = P2(pathC(AM.provMesh));
    this.lakesP = P2(pathC({ type: 'FeatureCollection', features: AM.lakes.map(l => l.f) }));
    this.waBorderP = P2(pathC(AM.waBorder));
    this.channel = AM.channel ? P2(pathC({ type: 'LineString', coordinates: AM.channel })) : null;   // the St Lawrence, cut out of the land
    this.grat = P2(geoPath(P.conic)(geoGraticule().extent([[-180, 15], [-50, 84]]).step([5, 5])()));
    // border / coast (lake outlines join the coast in LINES, stroked inside Canada only)
    const B = this.split = borderSplit(u.nation, AM.waBorder, P.conic, { lakes: { type: 'FeatureCollection', features: AM.lakes.map(l => l.f) }, can: AM.can });
    const ML = c => ({ type: 'MultiLineString', coordinates: c });
    this.border = P2(path(ML(B.border)));
    this.seam = P2(pathC(ML(B.seam)));
    this.borderWater = P2(pathC(ML(B.water)));
    this.coast = P2((path(ML(B.coast)) || '') + (pathC(AM.canCoast) || ''));
    this.box = this._boxes(u.nation, AM.can);
  }
  // frame boxes from the projected outline vertices (see AM_BOX)
  _boxes(nation, can) {
    const P = this.proj, b = {}, add = (n, p) => { const q = b[n] || (b[n] = [Infinity, Infinity, -Infinity, -Infinity]); q[0] = Math.min(q[0], p[0]); q[1] = Math.min(q[1], p[1]); q[2] = Math.max(q[2], p[0]); q[3] = Math.max(q[3], p[1]); };
    const put = (ll, p, grp) => {
      add('continent', p);
      const main = ll[0] > -170 && ll[0] < 0;                     // west of 180 the Aleutians have lon > 0
      if (main) add('mainland', p);
      if (main && ll[1] < 62) add('south', p);
      if (grp !== 'AK' && grp !== 'HI') add('conusCanada', p);
      if (grp === 'L48') add('conus', p);
    };
    for (const R of lines(nation)) {
      const grp = R[0][1] > 50 ? 'AK' : R[0][1] < 25 && R[0][0] < -150 ? 'HI' : 'L48';
      for (const ll of R) { const p = P(ll); if (P.isHI(ll) ? P.inInset(p) : p[0] >= AM_EXT[0][0] && p[0] <= AM_EXT[1][0] && p[1] >= AM_EXT[0][1] && p[1] <= AM_EXT[1][1]) put(ll, p, grp); }
    }
    for (const R of lines(can)) for (const ll of R) put(ll, P.conic(ll), 'CA');
    for (const k of Object.keys(b)) b[k] = b[k].map(v => Math.round(v * 100) / 100);
    return b;
  }
  // a cam that frames a preset box: 'continent' | 'mainland' | 'south' | 'conusCanada' | 'conus' (or [x0, y0, x1, y1])
  frame(name = 'continent', { w = 1080, h = 1920, pad = 0.04, sx, sy } = {}) {
    const q = Array.isArray(name) ? name : (this.box && this.box[name]) || AM_BOX[name];
    if (!q) throw new Error(`AmericaMap.frame: no box '${name}'`);
    const cam = { x: (q[0] + q[2]) / 2, y: (q[1] + q[3]) / 2, zoom: Math.min(w * (1 - 2 * pad) / (q[2] - q[0]), h * (1 - 2 * pad) / (q[3] - q[1])) };
    if (sx != null) cam.sx = sx; if (sy != null) cam.sy = sy;
    return cam;
  }
  // the ignition radius (map px) at which every county and cell is fully lit from origin (MAJORITY's ring end: us.reach(HOME))
  reach(origin, { noise = 0.35, pull = 60, width = 40 } = {}) {
    const o = this.proj(origin); let m = -Infinity;
    for (const c of this.R) { const d = Math.hypot(c.x - o[0], c.y - o[1]) * (1 + (c.r - 0.5) * noise) - c.wn * pull; if (d > m) m = d; }
    return m + width;
  }
  kmAt(origin, r, ang = -0.6) { return kmAt(origin, r, ang, this.proj); }

  // ---------------------------------------------------------------- bake (once): the USMap recipe in the offset map space
  _canvas(s) {
    const c = document.createElement('canvas'); c.width = Math.round(this.MAP[0] * s); c.height = Math.round(this.MAP[1] * s);
    const g = c.getContext('2d', { willReadFrequently: true }); g.setTransform(s, 0, 0, s, -this.ORG[0] * s, -this.ORG[1] * s);
    (this._cvs || (this._cvs = [])).push(c); return [c, g];
  }
  _bake() {
    if (this.gl) return;
    const t0 = performance.now(), O = this.ORG, M = this.MAP, ls = this.lightScale;
    const gl = this.gl = new GL(1080, 1920);
    const maxTex = gl.gl.getParameter(gl.gl.MAX_TEXTURE_SIZE) || 4096;
    let S = clamp(this.S, 1, 2.5); if (S * M[0] > maxTex) S = Math.floor(maxTex / M[0] * 2) / 2; this.S = S;   // ORG * S stays whole
    const fillAll = (g, style) => { g.fillStyle = style; g.fillRect(O[0], O[1], M[0], M[1]); };
    // 1. mask M: Canada + the seam (AM_SEAM wide, butt caps: the NE line where us-atlas leaves a sliver, never the rivers, the lakes or
    //    the coastal ends: borderSplit), minus the cut lakes and the St Lawrence channel
    const [mc, mg] = this._canvas(S), ch = g => { if (!this.channel) return; g.save(); g.lineWidth = AM_CHANNEL_W; g.lineCap = 'butt'; g.lineJoin = 'round'; g.stroke(this.channel); g.restore(); };
    mg.fillStyle = mg.strokeStyle = '#00f'; mg.lineJoin = 'round'; mg.lineCap = 'butt'; mg.lineWidth = AM_SEAM;
    mg.fill(this.canada); mg.stroke(this.seam);
    mg.globalCompositeOperation = 'destination-out'; mg.fill(this.lakesP); ch(mg); mg.globalCompositeOperation = 'source-over';
    // 2. ID: provinces (inside M) under the US counties; then cells by nearest seed
    const [ic, ig] = this._canvas(S), w = ic.width, h = ic.height, nUS = this.c.length;
    fillAll(ig, keyCSS(PB + UNK));
    ig.lineWidth = 2; ig.lineJoin = 'round';
    this.provinces.forEach((p, i) => { ig.fillStyle = ig.strokeStyle = keyCSS(PB + i); ig.fill(p.p); ig.stroke(p.p); });
    ig.save(); ig.setTransform(1, 0, 0, 1, 0, 0);
    ig.globalCompositeOperation = 'destination-in'; ig.drawImage(mc, 0, 0);
    ig.globalCompositeOperation = 'destination-over'; ig.fillStyle = '#000'; ig.fillRect(0, 0, w, h);
    ig.restore(); ig.globalCompositeOperation = 'source-over';
    this.c.forEach((c, i) => { ig.fillStyle = keyCSS(i + 1); ig.fill(c.p); });
    ig.strokeStyle = '#000'; ch(ig);                               // the channel is sea in ID too (no ink, no light keys on the river)
    const im = ig.getImageData(0, 0, w, h), D = im.data, ok = new Uint8Array(w * h);
    for (let i = 0, p = 0; p < w * h; p++, i += 4) { const k = D[i] + D[i + 1] * 256;
      ok[p] = (k === 0 && D[i + 2] === 0) || (((k > 0 && k <= nUS) || (k >= PB && k <= PB + UNK)) && D[i + 2] === chk(k)) ? 1 : 0; }
    for (let pass = 0; pass < 3; pass++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x; if (ok[p]) continue;
      for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < w * h && ok[q] === 1) { D[p * 4] = D[q * 4]; D[p * 4 + 1] = D[q * 4 + 1]; D[p * 4 + 2] = D[q * 4 + 2]; ok[p] = 2; break; }
    }
    for (let p = 0; p < w * h; p++) { if (!ok[p]) { D[p * 4] = D[p * 4 + 1] = D[p * 4 + 2] = 0; } D[p * 4 + 3] = 255; }
    assignCells(D, w, h, S, O, this.cells.map(c => [c.x, c.y]), this.cells.map(c => c.provIdx), PB, UNK, nUS + 1);
    this.tID = gl.upload(gl.tex({ filter: 'nearest' }), { data: new Uint8Array(D.buffer), w, h });
    // 3. heightfield (1.5x) from the ID keys: counties and cells alike, then blur, town mounds, blur
    const GR = new Uint8Array(this.R.length + 1); this.R.forEach((c, i) => { GR[i + 1] = Math.round(40 + 150 * Math.pow(c.wn, 1.8)); });
    const [hc, hg] = this._canvas(1.5), hw = hc.width, hh = hc.height, HD = hg.createImageData(hw, hh), Hd = HD.data;
    for (let y = 0; y < hh; y++) { const sy = Math.min(h - 1, Math.floor((y + 0.5) / 1.5 * S)) * w;
      for (let x = 0; x < hw; x++) { const i = (sy + Math.min(w - 1, Math.floor((x + 0.5) / 1.5 * S))) * 4, g = GR[D[i] + D[i + 1] * 256] || 0, o = (y * hw + x) * 4;
        Hd[o] = Hd[o + 1] = Hd[o + 2] = g; Hd[o + 3] = 255; } }
    hg.putImageData(HD, 0, 0);
    const [hb, hbg] = this._canvas(1.5); hbg.setTransform(1, 0, 0, 1, 0, 0);
    hbg.filter = 'blur(15px)'; hbg.drawImage(hc, 0, 0); hbg.filter = 'none';
    hbg.globalCompositeOperation = 'lighter'; hbg.setTransform(1.5, 0, 0, 1.5, -O[0] * 1.5, -O[1] * 1.5);
    for (const c of this.allCities) { if (c.pop < 20000) continue; const r = 5 + Math.sqrt(c.pop) * 0.018, a = Math.min(0.42, Math.sqrt(c.pop) / 2200);
      const g = hbg.createRadialGradient(c.x, c.y, 0, c.x, c.y, r); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      hbg.fillStyle = g; hbg.fillRect(c.x - r, c.y - r, 2 * r, 2 * r); }
    const [hf, hfg] = this._canvas(1.5); hfg.setTransform(1, 0, 0, 1, 0, 0); hfg.filter = 'blur(3px)'; hfg.drawImage(hb, 0, 0);
    const tHGT = gl.upload(gl.tex(), hf);
    // 4. LINES: r county (US), g state + province (inside Canada), b coast + cut-lake shores (inside Canada). No international line here.
    const [lc, lg] = this._canvas(S); fillAll(lg, '#000'); lg.lineJoin = 'round'; lg.globalCompositeOperation = 'lighter';
    lg.strokeStyle = '#f00'; lg.lineWidth = 0.45; lg.stroke(this.countyMesh);
    lg.strokeStyle = '#0f0'; lg.lineWidth = 1.0; lg.stroke(this.stateMesh);
    lg.save(); lg.clip(this.canada); lg.stroke(this.provMesh); lg.restore();
    lg.strokeStyle = '#00f'; lg.lineWidth = 1.5; lg.stroke(this.coast);
    lg.save(); lg.clip(this.canada); lg.stroke(this.lakesP); lg.restore();
    this.tLINES = gl.upload(gl.tex({ filter: 'mip' }), lc);
    // 5. AUX: b land (mask + nation), r rivers, g town cores
    const [ac, ag] = this._canvas(S); fillAll(ag, '#000');
    ag.save(); ag.setTransform(1, 0, 0, 1, 0, 0); ag.globalCompositeOperation = 'lighter'; ag.drawImage(mc, 0, 0); ag.restore();
    ag.fillStyle = '#00f'; ag.fill(this.nation);
    ag.strokeStyle = '#000'; ch(ag); ag.globalCompositeOperation = 'lighter';   // the channel through us-atlas's half of the river
    ag.strokeStyle = '#f00'; ag.lineWidth = 0.7;
    if (this.rivers) ag.stroke(this.rivers);
    if (this.riversCA) { ag.save(); ag.clip(this.canada); ag.stroke(this.riversCA); ag.restore(); }
    for (const c of this.allCities) {
      const k = Math.sqrt(c.pop / 5000), rc = (0.35 + 0.28 * k) * ls, g = ag.createRadialGradient(c.x, c.y, 0, c.x, c.y, rc);
      g.addColorStop(0, `rgba(0,${Math.min(255, 150 + 30 * k)},0,1)`); g.addColorStop(1, 'rgba(0,0,0,0)'); ag.fillStyle = g; ag.fillRect(c.x - rc, c.y - rc, 2 * rc, 2 * rc);
    }
    this.tAUX = gl.upload(gl.tex({ filter: 'mip' }), ac);
    // 6. LITE (1.5x): town glow
    const [tc, tg] = this._canvas(1.5); fillAll(tg, '#000'); tg.globalCompositeOperation = 'lighter';
    for (const c of this.allCities) {
      const k = Math.sqrt(c.pop / 5000), rg = (1.6 + 1.1 * k) * ls;
      const g = tg.createRadialGradient(c.x, c.y, 0, c.x, c.y, rg); g.addColorStop(0, `rgba(0,${Math.min(255, 40 + 18 * k)},0,1)`); g.addColorStop(1, 'rgba(0,0,0,0)');
      tg.fillStyle = g; tg.fillRect(c.x - rg, c.y - rg, 2 * rg, 2 * rg);
    }
    const tLITE = gl.upload(gl.tex(), tc);
    // 7. NRM (usmap.js's own shader)
    const nw = hf.width, nh = hf.height; gl.resize(nw, nh);
    gl.draw('nrm', US_FS_NRM, { MAP: this.MAP }, { HGT: tHGT, LITE: tLITE }, { w: nw, h: nh });
    this.tNRM = gl.copyTo(gl.tex(), nw, nh);
    // 8. free
    gl.gl.deleteTexture(tHGT); gl.gl.deleteTexture(tLITE);
    for (const c of this._cvs) { c.width = 0; c.height = 0; } this._cvs = [];
    this.tDATA = gl.tex({ filter: 'nearest' });
    this.ramps = {};
    gl.resize(1080, 1920);
    this.bakeMs = performance.now() - t0;
  }
  // engraving plate: inherited (FS_PLATE samples the map-space layers); America defaults keep it under ~2500 px wide
  plate({ scale = 1.4, pitchPx = 5, ...o } = {}) {
    const t0 = performance.now();
    super.plate({ ...o, scale: Math.min(scale, 2.2), pitchPx });
    this.gl.resize(1080, 1920);
    this.plateMs = performance.now() - t0;
  }

  // ---------------------------------------------------------------- per frame
  // pure (no GL): the default per-region loop over R (key i + 1 holds R[i]). lit: US counties; litCA: cells (procedural, never caption it)
  _frame({ ignite = null, t = 0, unlit = 1, dim = 1, flicker = 1, heat = ignite?.heat ?? 0.42 } = {}) {
    const fq = Math.floor(t * 15), front = [], D = this.data, nUS = this.c.length; let lit = 0, litCA = 0;
    this.R.forEach((c, i) => {
      const [L, F] = this._ign(c, ignite); if (L > 0.5) { if (i < nUS) lit++; else litCA++; }
      let v = (0.08 + 0.1 * c.wn) * unlit;
      if (L > 0) { const fl = flicker * (hash(+c.id, fq) - 0.5) * 0.08 * (1 - L * 0.5); v = lerp(v, (0.3 + 0.64 * Math.pow(c.wn, 2.2) + fl) * dim, ease.outCubic(L)); }
      v = clamp(v + F * heat); if (F > 0.35) front.push(c);
      const k = (i + 1) * 4; D[k] = v * 255; D[k + 1] = F * 255; D[k + 2] = c.wn * 255; D[k + 3] = L * 255;
    });
    return { D, front, lit, litCA };
  }
  // USMap.draw options, plus countyLines (scales the county mesh alpha: use 0 for continental shots, Canada has no county mesh),
  // border (the international line overlay, 0 hides it; default the style's `border` or 1, times `borders`), borderLakes (also the line
  // through the lakes), borderDash ([on, off] screen px). Returns { front, lit, litCA, cells }.
  draw(ctx, { cam = null, ignite = null, t = 0, style = 'ember', dim = 1, grid = 0.35, borders = 1, rivers = 0, flicker = 1, unlit = 1, relief = null,
    towns = null, light = [-0.7, -0.55, 0.5], res = 0.8, embers = true, alpha = 1, flush = true, countyLines = 1, border = null, borderLakes = false, borderDash = null } = {}) {
    this._bake();
    const S = typeof style === 'string' ? US_STYLES[style] : style;
    const cw = ctx.canvas.width, ch = ctx.canvas.height; this.view = [cw, ch];
    cam = cam || this.frame('continent', { w: cw, h: ch });
    const { D, front, lit, litCA } = this._frame({ ignite, t, unlit, dim, flicker });
    if (grid) { ctx.save(); const z = camApply(ctx, cam); ctx.strokeStyle = S.mode === 1 ? `rgba(11,11,11,${0.3 * grid})` : `rgba(201,31,55,${0.28 * grid})`; ctx.lineWidth = 1 / z; ctx.stroke(this.grat); ctx.restore(); }
    const gl = this.gl, gw = Math.round(cw * res), gh = Math.round(ch * res);
    gl.resize(Math.max(gl.canvas.width, gw), Math.max(gl.canvas.height, gh));
    gl.upload(this.tDATA, { data: D, w: 64, h: 64 });
    const lc = S.lines.map((l, i) => [l[0], l[1], l[2], l[3] * (i === 3 ? rivers : borders) * (i === 0 ? countyLines : 1)]);
    gl.draw('us', US_FS, {
      RES: [gw, gh], MAP: this.MAP, SCR: [(cam.sx ?? cw / 2) * res, (cam.sy ?? ch / 2) * res], CAMXY: [cam.x - this.ORG[0], cam.y - this.ORG[1]],
      ZOOM: (cam.zoom || 1) * res, ROT: cam.rot || 0, MODE: S.mode, RELIEF: relief ?? S.relief, TOWNS: towns ?? S.towns, T: t, HASPLATE: this.tPLATE ? 1 : 0, LDIR: light,
      LC0: lc[0], LC1: lc[1], LC2: lc[2], LC3: lc[3],
    }, { ID: this.tID, DATA: this.tDATA, NRM: this.tNRM, LINES: this.tLINES, AUX: this.tAUX, RAMP: this._ramp(S.ramp || 'ember'), PLATE: this.tPLATE || this.tNRM }, { w: gw, h: gh });
    ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(gl.canvas, 0, 0, gw, gh, 0, 0, cw, ch); ctx.restore();
    // the international line: an overlay on the US side of the seam, read like a state line of the style at bw = 1
    const bw = (border ?? S.border ?? 1) * borders;
    if (bw > 0) {
      ctx.save(); const z = camApply(ctx, cam), l1 = S.lines[1];
      ctx.globalAlpha *= alpha;
      ctx.strokeStyle = `rgba(${Math.round(l1[0] * 255)},${Math.round(l1[1] * 255)},${Math.round(l1[2] * 255)},${Math.min(1, l1[3] * bw)})`;
      ctx.lineWidth = Math.max(1.0, 1.25 / z); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (borderDash) ctx.setLineDash(borderDash.map(d => d / z));
      ctx.stroke(this.border); if (borderLakes) ctx.stroke(this.borderWater);
      ctx.restore();
    }
    if (flush) ctx.getImageData(0, 0, 1, 1);
    if (embers && front.length && ignite) {                      // the default burning edge, over counties and cells
      ctx.save(); const z = camApply(ctx, cam), o = ignite._o;
      ctx.globalCompositeOperation = S.mode === 1 || S.mode === 3 ? 'source-over' : 'lighter';
      for (const c of front) {
        const [, F] = this._ign(c, ignite), s = (1.5 + 4 * c.wn) / Math.sqrt(z);
        if (S.mode !== 1 && S.mode !== 3) { ctx.fillStyle = `rgba(255,120,80,${0.25 * F})`; ctx.beginPath(); ctx.arc(c.x, c.y, s * 2.6, 0, TAU); ctx.fill(); }
        ctx.fillStyle = S.mode === 3 ? `rgba(201,31,55,${F})` : `rgba(255,240,215,${0.7 * F})`; ctx.beginPath(); ctx.arc(c.x, c.y, s * 0.8, 0, TAU); ctx.fill();
        if (c.r > 0.55) { const ang = Math.atan2(c.y - o[1], c.x - o[0]) + (c.r - 0.75) * 2, fly = (1 - F) * 26 + 6;
          ctx.fillStyle = S.mode === 1 ? `rgba(11,11,11,${F})` : `rgba(255,190,120,${0.8 * F})`; ctx.fillRect(c.x + Math.cos(ang) * fly, c.y + Math.sin(ang) * fly, 2.4 / z, 2.4 / z); }
      }
      ctx.restore();
    }
    return { front, lit, litCA, cells: this.cells.length };
  }
  // towns as glowing points (largest first) over allCities, or which: 'us' | 'ca'. Every entry has r and wn, so ignite works here.
  towns(ctx, { cam, u = 1, minPop = 20000, color = '#fff1dc', glow = '#C91F37', max = 4000, size = 1, ignite = null, which = 'all' } = {}) {
    const list = which === 'us' ? this.cities : which === 'ca' ? this.caCities : this.allCities;
    ctx.save(); const z = camApply(ctx, cam);
    ctx.globalCompositeOperation = 'lighter';
    const n = Math.min(max, list.length);
    for (let i = 0; i < n; i++) {
      const c = list[i]; if (c.pop < minPop) break;
      if (i / n > u) break;
      let a = 1;
      if (ignite) { const [L] = this._ign(c, ignite); a = L; if (a <= 0) continue; }
      const s = (0.8 + Math.log10(c.pop / minPop + 1) * 2.4) * size / Math.sqrt(z);
      ctx.globalAlpha = 0.25 * a; ctx.fillStyle = glow; ctx.fillRect(c.x - s * 2.2, c.y - s * 2.2, s * 4.4, s * 4.4);
      ctx.globalAlpha = a; ctx.fillStyle = color; ctx.fillRect(c.x - s / 2, c.y - s / 2, s, s);
    }
    ctx.restore();
  }
}
