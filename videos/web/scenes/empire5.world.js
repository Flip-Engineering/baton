// CIVILIZATION c13: the world the argument happens on, back, drawn clean. A dot globe (the 13,395-dot land lattice from assets/geo/world.json) printed
// as hard round dots: black where it is abroad, red where it is home, a ruled ring for the limb, no shader, no glow, no atmosphere. The 750 bases are
// red-and-paper roundels (the hook's garrison). Gold arcs with a black keyline reel home; a counter strip runs under the globe.
import { feature } from '../node_modules/topojson-client/src/index.js';
import { geoContains, geoOrthographic, geoPath } from 'd3-geo';
import * as K from './empire5.kit.js';
const { P, g, RED, BLK, GOLD, PAPER, TAU, k, r, d, W, H, clamp, lerp, ease, rng, fillP, rect, circle, ring, lineP, text, knock } = K;

const J = async u => (await fetch(u)).json();
const [WORLD, tUS, USJ, tLand, tCty] = await Promise.all([J('../assets/geo/world.json'), J('../node_modules/us-atlas/states-10m.json'), J('../assets/geo/us.json'), J('../node_modules/world-atlas/land-50m.json'), J('../node_modules/world-atlas/countries-50m.json')]);
const LAND = feature(tLand, tLand.objects.land);
const USA = { type: 'FeatureCollection', features: feature(tCty, tCty.objects.countries).features.filter(f => f.properties.name === 'United States of America') };
// every US town the lattice names, biggest first: the lights
export const LIGHTS = USJ.cities.filter(c => c[0] > -125 && c[0] < -66 && c[1] > 24 && c[1] < 50).sort((a, b) => b[2] - a[2]);
const RAD = Math.PI / 180;
export const v3 = (lon, lat) => { const a = lon * RAD, b = lat * RAD, cb = Math.cos(b); return [cb * Math.sin(a), Math.sin(b), cb * Math.cos(a)]; };

// ---- the dots, and which of them are home (inside the 48 states, tested once)
const US_ST = feature(tUS, tUS.objects.states).features.filter(s => +s.id <= 56 && s.id !== '02' && s.id !== '15');
const ND = WORLD.dots.length, DX = new Float32Array(ND), DY = new Float32Array(ND), DZ = new Float32Array(ND), HOME = new Uint8Array(ND);
WORLD.dots.forEach(([lo, la], i) => { const v = v3(lo, la); DX[i] = v[0]; DY[i] = v[1]; DZ[i] = v[2];
  if (lo > -125 && lo < -66 && la > 24 && la < 50 && US_ST.some(s => geoContains(s, [lo, la]))) HOME[i] = 1; });

// ---- the garrison: 750 sites round real installations (the baked sample is a sample; the rest is scattered round the same places, as v12's Europe was)
// [lon, lat, count, spread (deg), born lo, born hi]: `born` orders the reveal when the years run 1945 -> 2026 (a clock, not a ledger)
const SITES = [
  [7.6, 49.44, 50, 0.7, 0.0, 0.3], [9.18, 48.78, 25, 0.5, 0.0, 0.3], [11.9, 49.7, 20, 0.5, 0.0, 0.3], [8.24, 50.08, 20, 0.5, 0.0, 0.3], [7.33, 49.65, 15, 0.5, 0, 0.3], [6.69, 49.98, 15, 0.5, 0.05, 0.35],
  [11.8, 49.2, 15, 0.5, 0, 0.3], [10.9, 49.9, 10, 0.6, 0, 0.3], [9.6, 53.6, 8, 0.8, 0, 0.3],
  [127.8, 26.4, 55, 0.4, 0.02, 0.3], [139.7, 35.3, 25, 0.35, 0.02, 0.3], [141.4, 40.7, 12, 0.3, 0.02, 0.3], [139.35, 35.75, 18, 0.3, 0.02, 0.3], [132.2, 34.1, 12, 0.3, 0.02, 0.3], [129.7, 33.2, 8, 0.3, 0.02, 0.3],
  [127.0, 36.96, 38, 0.4, 0.04, 0.3], [127.03, 37.09, 20, 0.3, 0.04, 0.3], [126.6, 35.9, 14, 0.3, 0.04, 0.3], [128.6, 35.9, 14, 0.3, 0.04, 0.3],
  [12.6, 46.03, 28, 0.4, 0.04, 0.4], [11.55, 45.55, 24, 0.4, 0.04, 0.4], [14.27, 40.85, 20, 0.3, 0.04, 0.4], [14.9, 37.4, 14, 0.3, 0.04, 0.4],
  [0.56, 52.41, 22, 0.5, 0.03, 0.4], [0.48, 52.36, 8, 0.4, 0.03, 0.4], [-1.79, 51.68, 9, 0.5, 0.03, 0.4], [-1.69, 54.0, 9, 0.5, 0.03, 0.4],
  [-6.35, 36.64, 14, 0.4, 0.05, 0.4], [-5.6, 37.17, 9, 0.4, 0.05, 0.4], [35.43, 37.0, 20, 0.5, 0.05, 0.45], [27.1, 38.4, 5, 0.4, 0.05, 0.45], [24.15, 35.53, 8, 0.3, 0.1, 0.5],
  [50.6, 26.2, 20, 0.25, 0.55, 0.85], [51.3, 25.1, 14, 0.3, 0.55, 0.85], [47.5, 29.3, 14, 0.4, 0.55, 0.85], [54.6, 24.25, 10, 0.4, 0.6, 0.9], [44.0, 33.0, 8, 0.8, 0.75, 0.95], [40.0, 36.5, 4, 0.5, 0.8, 0.95], [69.3, 34.9, 5, 0.8, 0.75, 0.95],
  [43.1, 11.55, 8, 0.2, 0.7, 0.85], [8.0, 17.0, 3, 0.4, 0.8, 0.95], [40.9, -2.2, 3, 0.4, 0.8, 0.95], [72.4, -7.3, 8, 0.1, 0.4, 0.5],
  [144.8, 13.5, 28, 0.15, 0.04, 0.4], [120.5, 15.2, 12, 0.5, 0.65, 0.95], [130.8, -12.4, 8, 0.4, 0.8, 0.98], [133.7, -23.8, 4, 0.3, 0.6, 0.8], [103.8, 1.3, 6, 0.15, 0.7, 0.95], [100.9, 12.7, 4, 0.5, 0.6, 0.9],
  [17.1, 54.5, 12, 0.6, 0.8, 0.98], [28.5, 44.4, 12, 0.6, 0.8, 0.98], [27.5, 42.5, 6, 0.4, 0.8, 0.98], [21.25, 42.37, 4, 0.3, 0.7, 0.9], [19.0, 47.5, 3, 0.5, 0.8, 0.98],
  [-22.6, 63.98, 5, 0.3, 0.1, 0.3], [3.99, 50.5, 10, 0.4, 0.05, 0.4], [5.97, 50.95, 5, 0.4, 0.05, 0.4], [-27.1, 38.76, 5, 0.2, 0.1, 0.4],
  [-87.6, 14.4, 5, 0.3, 0.5, 0.8], [-75.1, 19.9, 12, 0.15, 0.0, 0.1], [-68.7, 76.5, 3, 0.5, 0.1, 0.3], [-74.0, 4.6, 3, 1.5, 0.6, 0.9], [-68.9, 12.2, 3, 0.3, 0.6, 0.9],
];
const sumC = SITES.reduce((s, x) => s + x[2], 0);
export const BASES = (() => {
  const R = rng(1945), out = [], kf = 750 / sumC;
  let acc = 0;
  SITES.forEach((s, si) => { const n = si === SITES.length - 1 ? 750 - acc : Math.round(s[2] * kf); acc += n;
    for (let i = 0; i < n; i++) { const a = R() * TAU, rr = s[3] * Math.sqrt(R()); out.push({ lo: s[0] + Math.cos(a) * rr * 1.25, la: s[1] + Math.sin(a) * rr, born: lerp(s[4], s[5], R()), site: si }); } });
  out.sort((a, b) => a.born - b.born); out.length = Math.min(out.length, 750);
  while (out.length < 750) out.push({ ...out[out.length - 1], born: 0.99 });
  out.forEach((b, i) => { b.i = i; b.v = v3(b.lo, b.la); b.rank = i / 750; b.ger = b.site < 9; });
  return out; })();

// ---- home: real places the arcs land (towns the script names, and the Great Lakes towns the factories left)
export const TOWN = {
  AKRON: [-81.52, 41.08], RICHMOND: [-122.35, 37.94], BUFFALO: [-78.88, 42.89], OKLAHOMA: [-97.52, 35.47],
  DAYTON: [-84.19, 39.76], INDIANAPOLIS: [-86.16, 39.77], TOLEDO: [-83.54, 41.65], GARY: [-87.35, 41.59], YOUNGSTOWN: [-80.65, 41.1], FLINT: [-83.69, 43.01],
  DETROIT: [-83.05, 42.33], MILWAUKEE: [-87.91, 43.04], CLEVELAND: [-81.69, 41.5], PITTSBURGH: [-80.0, 40.44], ROCKFORD: [-89.09, 42.27], PEORIA: [-89.59, 40.69],
  RACINE: [-87.78, 42.73], SAGINAW: [-83.95, 43.42], ERIE: [-80.09, 42.13], SOUTHBEND: [-86.25, 41.68], CHICAGO: [-87.65, 41.85], LORAIN: [-82.18, 41.45],
};
const HOMES = ['DAYTON', 'INDIANAPOLIS', 'TOLEDO', 'GARY', 'YOUNGSTOWN', 'FLINT', 'DETROIT', 'MILWAUKEE', 'CLEVELAND', 'PITTSBURGH', 'ROCKFORD', 'PEORIA', 'RACINE', 'SAGINAW', 'ERIE', 'SOUTHBEND', 'LORAIN', 'CHICAGO', 'AKRON', 'BUFFALO', 'OKLAHOMA', 'RICHMOND'];
{ const R = rng(80); BASES.forEach(b => { b.home = HOMES[Math.floor(R() * HOMES.length)]; }); }
// the departure schedule: the garrison leaves from b38.6 to b48.0, slowly and then in handfuls; each base's arc flies FLIGHT beats and lands at T
export const T_HOME0 = 50.4, T_HOME1 = 60.0, FLIGHT = 1.3;
{ const R = rng(33); const order = BASES.map((b, i) => i).sort(() => R() - 0.5);
  order.forEach((bi, rank) => { const f = (rank + 1) / 750; BASES[bi].D = T_HOME0 + (T_HOME1 - T_HOME0) * Math.pow(f, 0.72); BASES[bi].T = BASES[bi].D + FLIGHT; }); }
// bases still abroad at beat b (the counter)
export const abroad = b => { let n = 0; for (const x of BASES) if (b < x.D) n++; return n; };

// ---- the globe
export function view(lon, lat, cx, cy, R) {
  const l0 = lon * RAD, p0 = lat * RAD, cl = Math.cos(l0), sl = Math.sin(l0), cp = Math.cos(p0), sp = Math.sin(p0);
  const f = (v) => { const x1 = v[0] * cl - v[2] * sl, z1 = v[0] * sl + v[2] * cl, y2 = v[1] * cp - z1 * sp, z2 = v[1] * sp + z1 * cp; return [cx + R * x1, cy - R * y2, z2]; };
  f.ll = (lo, la, lift = 0) => { const p = f(v3(lo, la)); return lift ? [cx + (p[0] - cx) * (1 + lift), cy + (p[1] - cy) * (1 + lift), p[2]] : p; };
  f.R = R; f.cx = cx; f.cy = cy; f.v = f; f.lon = lon; f.lat = lat;
  return f;
}
// c15: the globe is solid ink, as v5's was: land in press black, the United States in red, bare paper for the sea, two ruled rings for the limb.
// (c13's 13,395 dots averaged to grey at phone size.) Orthographic, clipped at the horizon, so it agrees with view() / arcPts() exactly.
const landPath = (V) => { const pj = geoOrthographic().rotate([-V.lon, -V.lat]).scale(V.R).translate([V.cx, V.cy]).clipAngle(90).precision(0.35); const gp = geoPath(pj); return [new Path2D(gp(LAND) || ''), new Path2D(gp(USA) || '')]; };
export function drawGlobe(V, { home = true, ringW = 9, sea = false } = {}) {
  const [land, us] = landPath(V), R = V.R;
  if (sea) { g.fillStyle = k(0.3); g.beginPath(); g.arc(V.cx, V.cy, R, 0, TAU); g.fill(); }
  g.fillStyle = k(1); g.fill(land);
  if (home) { g.fillStyle = r(1); g.fill(us); g.strokeStyle = k(1); g.lineWidth = 3; g.stroke(us); }
  g.strokeStyle = k(1); g.lineWidth = ringW; g.beginPath(); g.arc(V.cx, V.cy, R + 28, 0, TAU); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(V.cx, V.cy, R + 12, 0, TAU); g.stroke();
}
// roundels for a list of bases; `alive(b)` says whether each is still there; newly: bases that appeared within the last `pop` beats get a ring
export function drawBases(V, bases, { rr = 6.5, ping = null } = {}) {
  const ringP = new Path2D(), disc = new Path2D(), pingP = new Path2D();
  for (const b of bases) { const p = V(b.v); if (p[2] < 0.05) continue; const q = rr * (0.55 + 0.45 * p[2]);
    ringP.moveTo(p[0] + q + 2.6, p[1]); ringP.arc(p[0], p[1], q + 2.6, 0, TAU); disc.moveTo(p[0] + q, p[1]); disc.arc(p[0], p[1], q, 0, TAU);
    if (ping && ping(b) > 0) { const u = ping(b), rp = q + 4 + u * 26; pingP.moveTo(p[0] + rp, p[1]); pingP.arc(p[0], p[1], rp, 0, TAU); } }
  g.fillStyle = PAPER; g.fill(ringP); g.fillStyle = r(1); g.fill(disc);
  if (ping) { g.strokeStyle = k(1); g.lineWidth = 3; g.stroke(pingP); }
}
// a great-circle arc as screen points between two lon/lat, lifted off the sphere; head 0..1 along it, tail the fraction behind the head that is drawn
const slerp = (a, b, f) => { const dt = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])), om = Math.acos(dt), s = Math.sin(om) || 1, A = Math.sin((1 - f) * om) / s, B = Math.sin(f * om) / s;
  return [A * a[0] + B * b[0], A * a[1] + B * b[1], A * a[2] + B * b[2]]; };
export function arcPts(V, va, vb, head, tail = 1, lift = 0.22, n = 26) {
  const out = []; const dt = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])), om = Math.acos(dt), h = lift * Math.min(1, om / 1.6);
  const f0 = Math.max(0, head - tail);
  for (let j = 0; j <= n; j++) { const f = lerp(f0, head, j / n), v = slerp(va, vb, f), up = 1 + h * Math.sin(Math.PI * f), p = V([v[0] * up, v[1] * up, v[2] * up]); out.push(p); }
  return out;
}
export function strokeArc(pts, { core = d(1), edge = k(1), w = 5 } = {}) {
  const path = new Path2D(); let pen = false;
  for (const p of pts) { if (p[2] < 0.0) { pen = false; continue; } pen ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1]); pen = true; }
  g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = edge; g.lineWidth = w + 4; g.stroke(path); g.strokeStyle = core; g.lineWidth = w; g.stroke(path);
}

// ---- the counter strip: the count of bases abroad and the year, the whole way through
export function strip(count, year, { y = 1752, show = 1, gold = false } = {}) {
  const h = H - y; rect(0, y, W, h, k(1)); rect(0, y, W, 8, d(1));
  if (count != null) { text(String(count), 36, y + 140, 160, gold ? d(1) : PAPER, { font: 'Anton', align: 'left' }); const cw = String(count).length * 76 + 36 + 26;
    text('BASES', cw, y + 80, 60, PAPER, { font: 'Oswald', align: 'left' }); text('ABROAD', cw, y + 142, 60, PAPER, { font: 'Oswald', align: 'left' }); }
  if (year != null) text(String(year), W - 36, y + 140, 160, d(1), { font: 'Anton', align: 'right' });
}
export { US_ST };
