// CIVILIZATION v12, b0-24: the museum, the guard, the orders, the rents, the factories, the troopship. Each is one poster:
// one big object, flat ink, the type on a clean field. (The v11 maps and globes are gone from here.)
import { feature, mesh } from '../node_modules/topojson-client/src/index.js';
import { geoAzimuthalEqualArea, geoPath } from 'd3-geo';
import * as K from './empire5.kit.js';
const { P, g, RED, BLK, GOLD, PAPER, TAU, k, r, d, W, H, clamp, lerp, ease, rng, fillP, rect, circle, ring, lineP, strokeP, poly, text, knock, mkPath, rectPath, circPath, xf, sg, sign, signAt, signOut } = K;

const J = async u => (await fetch(u)).json();
const [tL50, tC50] = await Promise.all(['../node_modules/world-atlas/land-50m.json', '../node_modules/world-atlas/countries-50m.json'].map(J));
const EURN = new Set(['Iceland', 'Norway', 'Sweden', 'Finland', 'Denmark', 'Ireland', 'United Kingdom', 'France', 'Spain', 'Portugal', 'Andorra', 'Belgium', 'Netherlands', 'Luxembourg', 'Germany',
  'Switzerland', 'Austria', 'Italy', 'Poland', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia', 'Bosnia and Herz.', 'Serbia', 'Montenegro', 'Kosovo', 'Albania', 'North Macedonia', 'Greece',
  'Bulgaria', 'Romania', 'Moldova', 'Ukraine', 'Belarus', 'Lithuania', 'Latvia', 'Estonia', 'Turkey', 'Cyprus', 'Malta', 'Liechtenstein', 'San Marino', 'Vatican', 'Monaco']);
const CF = feature(tC50, tC50.objects.countries).features.filter(f => EURN.has(f.properties.name));
const LAND50 = { type: 'FeatureCollection', features: CF };
const BORDERS = mesh(tC50, tC50.objects.countries, (a, b) => a !== b && EURN.has(a.properties.name) && EURN.has(b.properties.name));
const P2 = (proj, obj) => new Path2D(geoPath(proj)(obj) || '');
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const ART = {};
for (const [kk, f] of [['aristotle', 'met437394_aristotle_with_a_bust_of_homer.jpg'], ['vermeer', 'met437881_young_woman_with_a_water_pitcher.jpg'],
  ['harvesters', 'met435809_the_harvesters.jpg'], ['socrates', 'met436105_the_death_of_socrates.jpg']]) ART[kk] = await loadImg('../assets/art_pd/' + f);

// ---------------------------------------------------------------- shared pieces
// a gilt frame: flat gold moulding, black keylines, a lower-right shade in the black plate's light stone
export function gilt(x, y, w, h, th, { shade = true } = {}) {
  const o = new Path2D(); o.rect(x, y, w, h); o.rect(x + th, y + th, w - 2 * th, h - 2 * th);
  fillP(o, d(1), 'evenodd');
  if (shade) { const s = new Path2D(); s.moveTo(x + w, y); s.lineTo(x + w - th, y + th); s.lineTo(x + w - th, y + h - th); s.lineTo(x + th, y + h - th); s.lineTo(x, y + h); s.lineTo(x + w, y + h); s.closePath(); fillP(s, k(0.3)); }
  g.strokeStyle = k(1); g.lineWidth = 3; g.strokeRect(x, y, w, h); g.strokeRect(x + th, y + th, w - 2 * th, h - 2 * th);
  g.lineWidth = 2; for (const f of [0.34, 0.66]) g.strokeRect(x + th * f, y + th * f, w - 2 * th * f, h - 2 * th * f);
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { const px = cx + (cx === x ? th / 2 : -th / 2), py = cy + (cy === y ? th / 2 : -th / 2); ring(px, py, th * 0.3, 3, k(1)); circle(px, py, th * 0.12, k(1)); }
}
// a painting laid in the photo layer (separated into the three inks and screened), cover-fit into a box, over a knocked field
function hang(img, x, y, w, h, fx = 0.5, fy = 0.5, zoom = 1) {
  knock(rectPath(x, y, w, h));
  const s = Math.max(w / img.width, h / img.height) * zoom, sw = w / s, sh = h / s;
  P.photo(img, (img.width - sw) * fx, (img.height - sh) * fy, sw, sh, x, y, w, h);
}
// the guard from behind at parade rest (M1, rifle on its sling): [helmet, neck, jacket and legs, rifle, sling] as paths
export function guardBack(x, y, h, sway = 0) {
  const m = new DOMMatrix().translateSelf(x, y).rotateSelf(sway * 57.3).scaleSelf(h, h), out = [];
  const piece = f => { const q = new Path2D(); f(q); const p = new Path2D(); p.addPath(q, m); out.push(p); };
  piece(q => { q.moveTo(-0.084, -0.902); q.bezierCurveTo(-0.088, -0.962, -0.052, -1.0, 0, -1.0); q.bezierCurveTo(0.052, -1.0, 0.088, -0.962, 0.084, -0.902);
    q.lineTo(0.09, -0.897); q.lineTo(0.088, -0.889); q.lineTo(-0.088, -0.889); q.lineTo(-0.09, -0.897); q.closePath(); });
  piece(q => q.rect(-0.036, -0.895, 0.072, 0.05));
  piece(q => { q.moveTo(-0.05, -0.862); q.quadraticCurveTo(-0.1, -0.858, -0.132, -0.836);
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
  piece(q => { q.moveTo(0.104, -1.105); q.lineTo(0.112, -1.105); q.lineTo(0.113, -1.09); q.lineTo(0.118, -1.089); q.lineTo(0.12, -0.86);
    q.lineTo(0.128, -0.855); q.lineTo(0.136, -0.72); q.lineTo(0.15, -0.7); q.lineTo(0.152, -0.64); q.lineTo(0.166, -0.52);
    q.lineTo(0.146, -0.506); q.lineTo(0.124, -0.52); q.lineTo(0.118, -0.64); q.lineTo(0.112, -0.72); q.lineTo(0.106, -0.86); q.closePath(); });
  piece(q => { q.moveTo(0.105, -1.06); q.lineTo(0.098, -1.06); q.lineTo(0.064, -0.84); q.lineTo(0.072, -0.838); q.closePath(); });
  return out;
}

// the exchange: a temple front, drawn as one object. base y, width, and the label cut in the frieze.
// returns the frieze box and the apex. cols stripes of black with paper between; flat, no tone.
export function temple(cx, by, w, h, { cols = 6, label = 'WALL ST', col = k(1), cut = PAPER, labelSize = 0, flute = true } = {}) {
  const stepH = h * 0.075, colH = h * 0.5, friezeH = h * 0.2, pedH = h * 0.225, x0 = cx - w / 2;
  const steps = new Path2D(); for (let j = 0; j < 3; j++) steps.rect(x0 - (2 - j) * w * 0.018, by - (j + 1) * stepH / 3, w + (2 - j) * w * 0.036, stepH / 3 + 0.5);
  fillP(steps, col);
  const cy1 = by - stepH, cy0 = cy1 - colH, colW = w * 0.088, xs = [];
  const body = new Path2D();
  for (let i = 0; i < cols; i++) { const x = x0 + w * 0.07 + (i + 0.5) * (w * 0.86) / cols; xs.push(x); body.rect(x - colW / 2, cy0, colW, colH); }
  const fy0 = cy0 - friezeH; body.rect(x0, fy0, w, friezeH);
  const apex = [cx, fy0 - pedH]; body.moveTo(x0 - w * 0.02, fy0); body.lineTo(apex[0], apex[1]); body.lineTo(x0 + w * 1.02, fy0); body.closePath();
  fillP(body, col);
  // fluting: a paper line down each column
  g.strokeStyle = cut; g.lineWidth = Math.max(2, w * 0.004);
  if (flute) for (const x of xs) for (const f of [-0.22, 0.22]) { g.beginPath(); g.moveTo(x + f * colW, cy0 + 14); g.lineTo(x + f * colW, cy1 - 14); g.stroke(); }
  // the cornice line between the pediment and the frieze
  g.lineWidth = Math.max(3, w * 0.006); g.beginPath(); g.moveTo(x0 + 6, fy0); g.lineTo(x0 + w - 6, fy0); g.stroke();
  const fr = { x1: x0, x2: x0 + w, y1: fy0, y2: cy0, apex, by, cx };
  if (label) { const sz = labelSize || friezeH * 0.76; g.font = `${sz}px "Anton"`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = cut; g.fillText(label, cx, fy0 + friezeH * 0.5 + sz * 0.36); }
  return fr;
}

// ---------------------------------------------------------------- b0 the hook: Europe, garrisoned
// real sites (lon, lat) for the named installations; the rest of the count is scattered round them
const SITES = [[7.6, 49.44], [9.18, 48.78], [11.9, 49.7], [7.33, 49.65], [6.69, 49.98], [8.24, 50.08], [8.7, 49.4], [7.77, 49.45], [10.89, 49.89], [10.6, 49.3], [11.8, 49.2],
  [12.6, 46.03], [11.55, 45.55], [14.9, 37.4], [14.27, 40.85], [10.3, 43.6], [-6.35, 36.64], [-5.6, 37.17], [0.56, 52.41], [-1.79, 51.68], [-1.69, 54.0], [35.43, 37.0], [27.1, 38.4],
  [24.15, 35.53], [-22.6, 63.98], [17.85, 52.38], [17.1, 54.48], [24.4, 44.08], [28.49, 44.36], [21.25, 42.37], [3.99, 50.5], [5.97, 50.95], [-8.6, 39.0], [13.1, 47.9], [9.6, 53.6],
  [6.1, 49.6], [4.4, 51.2], [14.4, 50.1], [19.0, 47.5], [26.1, 44.4], [23.7, 37.9], [-3.7, 40.4], [-9.1, 38.7], [1.4, 43.6], [8.5, 47.4], [12.2, 53.9], [16.0, 54.3], [21.0, 52.2]];
const EUR_STARS = (() => { const R = rng(1945), out = []; for (const s of SITES) out.push([s[0], s[1]]);
  const dense = SITES.slice(0, 12);                       // the German cluster is thick: scatter round it
  for (let i = 0; i < 70; i++) { const s = dense[Math.floor(R() * dense.length)]; out.push([s[0] + (R() - 0.5) * 2.2, s[1] + (R() - 0.5) * 1.5]); }
  for (let i = 0; i < 26; i++) { const s = SITES[12 + Math.floor(R() * (SITES.length - 12))]; out.push([s[0] + (R() - 0.5) * 1.2, s[1] + (R() - 0.5) * 0.9]); }
  return out; })();
const starPath = (x, y, rad) => { const p = new Path2D(); for (let j = 0; j < 10; j++) { const rr = j % 2 ? rad * 0.4 : rad, a = -Math.PI / 2 + j * Math.PI / 5; j ? p.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)) : p.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); } p.closePath(); return p; };
export function europeMap(b, { cx = 500, cy = 1470, sc = 1150, rad = 19, pop = 1 } = {}) {
  const proj = geoAzimuthalEqualArea().rotate([-14, -49]).scale(sc).translate([cx, cy]).precision(0.5);
  fillP(P2(proj, LAND50), k(1));
  // borders: a paper hairline between the countries
  g.strokeStyle = PAPER; g.lineWidth = 2.5; g.stroke(P2(proj, BORDERS));
  const kept = [];
  for (const [lo, la] of EUR_STARS) { const p = proj([lo, la]); if (!p || p[0] < 20 || p[0] > W - 20 || p[1] < 900 || p[1] > H - 20) continue; if (kept.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < rad * 2.3)) continue; kept.push(p); }
  const pts = kept;
  // the roundels: a red disc, a paper ring, a paper star; an older garrison is printed first
  const n = Math.round(pts.length * pop);
  for (let i = 0; i < n; i++) { const [x, y] = pts[i]; circle(x, y, rad + 3.5, PAPER); circle(x, y, rad, r(1)); }
  for (let i = 0; i < n; i++) { const [x, y] = pts[i]; fillP(starPath(x, y + 1, rad * 0.78), PAPER); }
  return proj;
}
export function shotEurope(b, t) {
  const age = b - 0, z = 1 + 0.012 * age;
  g.save(); g.translate(540, 1500); g.scale(z, z); g.translate(-540, -1500);
  europeMap(b);
  g.restore();
  return { misreg: 1.6 + 6 * Math.exp(-age * 8) };
}

// ---------------------------------------------------------------- b2 the museum: one painting, one placard
export function shotMuseum(b, t) {
  const age = b - 2, z = 1 + 0.02 * age;
  g.save(); g.translate(540, 1150); g.scale(z, z); g.translate(-540, -1150);
  const fx = 190, fy = 800, fw = 700, fh = 700, th = 52;
  // the wall's shadow: a hard offset shape in the stone tint
  rect(fx + 22, fy + 22, fw, fh, k(0.3));
  hang(ART.aristotle, fx + th, fy + th, fw - 2 * th, fh - 2 * th, 0.5, 0.35);
  gilt(fx, fy, fw, fh, th);
  // the placard: black card, gold edge, paper letters
  const px = 150, py = 1590, pw = 780, ph = 230;
  rect(px + 16, py + 16, pw, ph, k(0.3));
  rect(px, py, pw, ph, k(1)); g.strokeStyle = d(1); g.lineWidth = 6; g.strokeRect(px + 14, py + 14, pw - 28, ph - 28);
  text('EUROPE · 1945–', px + pw / 2, py + 120, 100, PAPER, { font: 'Oswald' });
  text('PERMANENT COLLECTION', px + pw / 2, py + 184, 50, PAPER, { font: 'Oswald' });
  g.restore();
  return { misreg: 1.6 + 5 * Math.exp(-age * 8) };
}

// ---------------------------------------------------------------- b4 the guard: back to us, among the frames
export function shotGuard(b, t) {
  const age = b - 4, z = (1 + 0.04 * Math.exp(-age * 5)) * (1 + 0.012 * age), fx0 = 560, fy0 = 1200;
  const X = x => fx0 + (x - fx0) * z, Y = y => fy0 + (y - fy0) * z, S = v => v * z;
  rect(0, 0, W, H, r(1));                                        // the oxblood wall is the piece's own red
  rect(0, Y(1530), W, H, k(1));                                  // the floor
  g.strokeStyle = d(1); g.lineWidth = 6; g.beginPath(); g.moveTo(0, Y(1530)); g.lineTo(W, Y(1530)); g.stroke();
  g.strokeStyle = k(1); g.lineWidth = 4; g.beginPath(); g.moveTo(0, Y(1380)); g.lineTo(W, Y(1380)); g.stroke();   // the dado rail
  // the paintings: Rembrandt (centre, big), Vermeer (left, cropped), Bruegel (right, cropped)
  const FR = [[ART.socrates, 270, 800, 540, 520, 46, 0.5, 0.4], [ART.vermeer, -170, 880, 340, 420, 34, 0.5, 0.3], [ART.harvesters, 890, 900, 330, 300, 30, 0.45, 0.5]];
  for (const [img, x, y, w, h, th, fx, fy] of FR) { const X0 = X(x), Y0 = Y(y), W0 = S(w), H0 = S(h), T0 = S(th);
    rect(X0 + S(14), Y0 + S(14), W0, H0, k(1));
    hang(img, X0 + T0, Y0 + T0, W0 - 2 * T0, H0 - 2 * T0, fx, fy); gilt(X0, Y0, W0, H0, T0, { shade: false }); }
  // the velvet rope on brass posts, behind him
  { const ry = Y(1470), posts = [X(110), X(1010)];
    for (const px of posts) { rect(px - S(10), ry - S(26), S(20), S(150), d(1)); circle(px, ry - S(30), S(20), d(1)); strokeP(circPath(px, ry - S(30), S(20)), k(1), 3); g.strokeStyle = k(1); g.lineWidth = 3; g.strokeRect(px - S(10), ry - S(26), S(20), S(150)); }
    const rope = new Path2D(); rope.moveTo(posts[0], ry); rope.quadraticCurveTo((posts[0] + posts[1]) / 2, ry + S(140), posts[1], ry);
    g.lineCap = 'round'; strokeP(rope, k(1), S(28)); strokeP(rope, r(1), S(20)); }
  // the guard
  const gx = X(610), gy = Y(1960), gh = S(1090), sway = Math.sin(t * 1.1) * 0.003;
  const pcs = guardBack(gx, gy, gh, sway);
  for (const p of pcs) { g.save(); g.translate(7, -6); g.fillStyle = d(1); g.fill(p); g.restore(); }       // the gold rim, thrown up and right by the picture lights
  for (const p of pcs) knock(p, 0);
  for (const p of pcs) { g.save(); g.translate(7, -6); g.fillStyle = d(1); g.fill(p); g.restore(); }
  for (const p of pcs) fillP(p, k(1));
  return { misreg: 1.6 + 6 * Math.exp(-age * 7) };
}

// ---------------------------------------------------------------- b8 the orders: the exchange, and the wires going out
export function shotOrders(b, t) {
  const age = b - 8, punch = ease.outExpo(clamp((b - 10) / 0.25)), z = (1 + 0.07 * Math.exp(-age * 6)) * (1 + 0.1 * punch) + age * 0.015;
  rect(0, 0, W, H, d(0.5));                                      // the ground: a pale gold wash, flat
  g.save(); g.translate(540, 1800); g.scale(z, z); g.translate(-540, -1800);
  const fr = temple(540, 1800, 1000, 1000, { cols: 6, label: 'WALL ST' });
  g.restore();
  const src = [540, (fr.y1 + fr.y2) / 2 * 0 + 1800 - (1800 - (1800 - 1000 * 0.075 - 1000 * 0.5 - 1000 * 0.1)) * z * 1], u = ease.inOutCubic(clamp((age - 0.15) / 1.3));
  const fy = 1800 - (1800 - (1800 - 75 - 500 - 100)) * z;     // the frieze's centre after the zoom
  const R = rng(808), n = 22;
  for (let i = 0; i < n; i++) {
    const side = i % 3, e = side === 0 ? [60 + R() * (W - 120), -60] : side === 1 ? [-60, 80 + R() * 1000] : [W + 60, 80 + R() * 1000];
    const sag = 60 + R() * 140, pts = [];
    for (let j = 0; j <= 22; j++) { const f = j / 22 * u; pts.push([lerp(540, e[0], f), lerp(fy - 40, e[1], f) + Math.sin(Math.PI * f) * sag * 0.4]); }
    if (u > 0.01) lineP(pts, k(1), 4);
    if (u > 0.2) { const q = ((age * 2 + R()) % 1) * u, j = Math.min(21, Math.floor(q * 22)), [px, py] = pts[j]; circle(px, py, 13, k(1)); circle(px, py, 8, d(1)); }
  }
  return { misreg: 1.6 + 7 * Math.exp(-age * 7) + 5 * (b >= 10 ? Math.exp(-(b - 10) * 7) : 0), flash: age < 0.066 ? 0.3 : 0 };
}
