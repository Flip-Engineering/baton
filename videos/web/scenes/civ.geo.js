// CIVILIZATION v15: one globe, one camera. A single orthographic projection whose centre, roll, radius and screen anchor are keyframed, so the
// shot never cuts: the world at R~800, Europe at R~1900, the 48 states at R~1150, the Great Lakes at R~4000 and the foot of Manhattan at R~2.7M
// are the same sphere seen closer. (The shared geo tools have no globe-to-map morph; an orthographic zoom needs none.)
//
//   const W = await loadWorld();           // land, borders, the US, lower Manhattan
//   const cam = camAt(beat);               // { lon, lat, roll, R, ax, ay }
//   const V = view(cam);                   // V.pt([lon, lat], alt) -> [x, y, visible, z]; V.proj (d3), V.path(geo) -> Path2D
import { feature, mesh } from '../node_modules/topojson-client/src/index.js';
import { geoGraticule } from 'd3-geo';
import { view, makeCam, camOnArc, v3 } from '../lib/fx/geo/zoomcam.js';
export { view, makeCam, camOnArc, v3 };

const J = async u => (await fetch(u)).json();

export async function loadWorld() {
  const [t50, c50, t10, st, lm, sn, usj] = await Promise.all(['../node_modules/world-atlas/land-50m.json', '../node_modules/world-atlas/countries-50m.json', '../node_modules/world-atlas/land-10m.json',
    '../node_modules/us-atlas/states-10m.json', '../assets/geo/lower_manhattan.json', '../node_modules/sane-topojson/dist/world_50m.json', '../assets/geo/us.json'].map(J));
  const W = {};
  W.land50 = feature(t50, t50.objects.land); W.land10 = feature(t10, t10.objects.land);
  W.borders = mesh(c50, c50.objects.countries, (a, b) => a !== b);
  W.us = feature(st, st.objects.nation); W.usStates = mesh(st, st.objects.states, (a, b) => a !== b);
  W.can = feature(c50, c50.objects.countries).features.find(f => f.id === '124');      // v18: America is the US and Canada (the ACP's territory; acp-constitution.txt)
  W.cities = usj.cities.slice().sort((a, b) => b[2] - a[2]);                // [lon, lat, pop, name, state]
  W.lakes = feature(sn, sn.objects.lakes);
  W.grat = geoGraticule().step([15, 15])();
  // lower Manhattan: land rings (re-wound clockwise for d3), streets as one MultiLineString per class
  const cw = ring => { let a = 0; for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return a < 0 ? ring : ring.slice().reverse(); };
  W.nyLand = { type: 'MultiPolygon', coordinates: lm.land.map(r => [cw(r)]) };
  W.box = lm.box; { const [x0, y0, x1, y1] = lm.box; W.nyBox = { type: 'Polygon', coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]] }; }
  const by = { major: [], minor: [], hw: [] }, named = {};
  for (const s of lm.streets) {
    (s.t === 2 ? by.hw : s.w >= 50 ? by.major : by.minor).push(s.p);
    (named[s.n] ||= []).push(s.p);
  }
  W.streets = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { type: 'MultiLineString', coordinates: v }]));
  W.named = named;
  // c20: Akron at street scale (tools/bake_akron.py, TIGER/Line): the second dive, to where the work is done
  const ak = await J('../assets/geo/akron.json'), MLS = c => ({ type: 'MultiLineString', coordinates: c });
  const ccw = ring => { let a = 0; for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return a < 0 ? ring : ring.slice().reverse(); };
  const akNamed = {}; for (const s of ak.streets) (akNamed[s.n] ||= []).push(s.p);
  W.akron = { streets: { major: MLS(ak.streets.filter(s => s.t === 2).map(s => s.p)), minor: MLS(ak.streets.filter(s => s.t !== 2).map(s => s.p)) },
    rails: MLS(ak.rails), water: MLS(ak.water.map(w => w.p)), lakes: { type: 'MultiPolygon', coordinates: ak.lakes.map(r => [ccw(r)]) }, named: akNamed, box: ak.box };
  return W;
}

