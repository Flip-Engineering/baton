// CIVILIZATION c13, b12-20: Wall Street at work on real places. The rents rise in the metros and run back to Manhattan; the factories on their Great
// Lakes towns are pulled out along strings to the sea, and the towns are left ringed and empty. One poster map each (red land, paper state lines).
import { feature, mesh } from '../node_modules/topojson-client/src/index.js';
import { geoAlbers, geoPath } from 'd3-geo';
import * as K from './empire5.kit.js';
import { TOWN } from './empire5.world.js';
import { ticker } from './empire5.shots8.js';
const { P, g, RED, BLK, GOLD, PAPER, TAU, k, r, d, W, H, clamp, lerp, ease, rng, fillP, rect, circle, ring, lineP, strokeP, poly, text, knock, sg, signOut } = K;
const fr = K.frame;
const J = async u => (await fetch(u)).json();
const tUS = await J('../node_modules/us-atlas/states-10m.json');
const L48 = s => +s.id <= 56 && s.id !== '02' && s.id !== '15';
const ST = feature(tUS, tUS.objects.states).features.filter(L48);
const US48 = { type: 'FeatureCollection', features: ST };
const ST_LINES = mesh(tUS, tUS.objects.states, (a, b) => a !== b && L48(a) && L48(b));
const NATION = mesh(tUS, tUS.objects.states, (a, b) => a === b && L48(a));
const P2 = (proj, obj) => new Path2D(geoPath(proj)(obj) || '');
const mapLand = (proj, w = 3) => { const land = P2(proj, US48); fillP(land, r(1)); strokeP(P2(proj, ST_LINES), PAPER, w); strokeP(P2(proj, NATION), k(1), 4.5); return land; };
const NYC = [-74.0, 40.71];
const coin = (x, y, rr) => { circle(x, y, rr, k(1)); circle(x, y, rr - 4, d(1)); ring(x, y, rr * 0.55, 2.5, k(1)); };

// ---------------------------------------------------------------- b12 rents: a coin tower rises over each metro, and the rent runs home to Manhattan
const METROS = [['LOS ANGELES', -118.24, 34.05, 1.1], ['SAN FRANCISCO', -122.42, 37.77, 1.4], ['SEATTLE', -122.33, 47.61, 1.0], ['DENVER', -104.99, 39.74, 0.8], ['HOUSTON', -95.37, 29.76, 1.2],
  ['CHICAGO', -87.63, 41.88, 1.3], ['ATLANTA', -84.39, 33.75, 0.9], ['MIAMI', -80.19, 25.76, 1.5], ['BOSTON', -71.06, 42.36, 1.0], ['PHOENIX', -112.07, 33.45, 0.7]];
export function shotRents(b, t) {
  const age = b - 12;
  const A = geoAlbers().fitExtent([[40, 880], [1040, 1700]], US48).precision(0.5);
  mapLand(A);
  const ny = A(NYC);
  // the strings: from every tower's base to Manhattan, a gold pulse running home
  const base = METROS.map(m => A([m[1], m[2]]));
  base.forEach((p, i) => { if (age < 0.25 + i * 0.05) return; const q = (age * 1.4 + i * 0.37) % 1;
    g.save(); g.setLineDash([26, 22]); lineP([p, ny], k(1), 6); g.restore();
    const px = lerp(p[0], ny[0], q), py = lerp(p[1], ny[1], q); circle(px, py, 11, k(1)); circle(px, py, 6.5, d(1)); });
  // the towers
  METROS.forEach((m, i) => { const p = base[i], n = Math.min(13, Math.floor(Math.max(0, age - 0.1 - i * 0.04) * 3.4 * m[3] + (age > 0.05 ? 1 : 0)));
    for (let c = 0; c < n; c++) coin(p[0], p[1] - 66 - c * 17, 24);
    sg('rent', p[0], p[1] + 18, 78, k(1), { lod: 1 }); });
  // Manhattan: the bank, and the sum of them in coins
  const nn = Math.min(18, Math.floor(age * 5)), tx = ny[0] - 20;
  for (let c = 0; c < nn; c++) coin(tx, ny[1] - 90 - c * 17, 30);
  sg('bank', tx, ny[1] + 22, 130, k(1), { lod: 1 });
  ticker(b, t, { pick: ['RENT  \u25B2 4.9', 'LANDLORDS  \u25B2 4.4', 'REITS  \u25B2 2.2', 'RENT  \u25B2 5.1'] });
  return { misreg: 1.6 + 3 * Math.exp(-age * 6) };
}

// ---------------------------------------------------------------- b16 factories: pulled out along the strings to the sea; the towns are left ringed
const FACT = ['DETROIT', 'FLINT', 'TOLEDO', 'DAYTON', 'INDIANAPOLIS', 'GARY', 'AKRON', 'BUFFALO'];
const LAB = { DETROIT: [1, -1], FLINT: [-1, -1], TOLEDO: [1, 1], DAYTON: [1, 1], INDIANAPOLIS: [-1, 1], GARY: [-1, -1], AKRON: [1, 1], BUFFALO: [-1, -1] };
export function shotFactories(b, t) {
  const age = b - 16;
  const A = geoAlbers().rotate([82.8, 0]).center([0, 41.4]).parallels([29.5, 45.5]).scale(4600).translate([470, 1310]).precision(0.4);
  mapLand(A, 3);
  const order = [7, 6, 2, 0, 1, 3, 4, 5];
  // the plants leave in turn, up and out over the east coast to the sea; Akron's goes last, and is the one we stay with
  FACT.forEach((nm, i) => {
    const p = A(TOWN[nm]), li = order.indexOf(i), go = fr(age, 0.4 + li * 0.28, 1.5 + li * 0.28), e = ease.inOutCubic(go);
    ring(p[0], p[1], nm === 'AKRON' ? 24 : 15, nm === 'AKRON' ? 9 : 6, k(1));
    if (go < 1) { const fx = lerp(p[0], 1260, e), fy = lerp(p[1], p[1] - 160, e) - Math.sin(Math.PI * e) * 120; sg('factory', fx, fy, 124, k(1), { lod: 1 }); }
    else circle(p[0], p[1], nm === 'AKRON' ? 14 : 9, PAPER);
  });
  FACT.forEach(nm => { const p = A(TOWN[nm]), [dx, dy] = LAB[nm], ak = nm === 'AKRON', s = ak ? 66 : 46; g.font = `${s}px "Oswald"`; g.textAlign = dx < 0 ? 'right' : 'left'; g.textBaseline = 'alphabetic';
    const x = p[0] + dx * (ak ? 34 : 26), y = p[1] + (dy < 0 ? -22 : ak ? 66 : 54), tw = g.measureText(nm).width;
    const kp = new Path2D(); kp.rect(dx < 0 ? x - tw - 6 : x - 6, y - s + 4, tw + 12, s + 6); knock(kp); g.fillStyle = ak ? r(1) : k(1); g.fillText(nm, x, y); });
  ticker(b, t, { pick: ['PLANT CLOSED  \u25B2 6.1', 'OFFSHORE  \u25B2 5.7', 'SHARE BUYBACK  \u25B2 7.0', 'PLANT CLOSED  \u25B2 6.4'] });
  return { misreg: 1.6 + 3 * Math.exp(-age * 6) };
}
