// SIGNS: an Isotype-style sign family for the slate's recurring things (STUDIO CIV ASSETS c1, 1 Oct).
//
// Gerd Arntz cut each of his ~4,000 signs as a designed linocut on a grid, so a row of identical signs could COUNT
// (one soldier = 10,000 soldiers). CIVILIZATION drew its mills, bases, ships and coins as ad-hoc paths at whatever size
// a shot needed (52-px mills, 10-px blob pins, a troopship that does not read as a ship at phone size). Here each sign
// is designed once on a 100-unit grid, in THREE levels of detail, so small never means a shrunken hero:
//   lod 0 (thumb, under ~48 px tall): one bold silhouette, no gap narrower than ~8 units
//   lod 1 (mid, ~48-180 px): the cuts that name it (windows, the flag's star, the funnel band, wheel hubs)
//   lod 2 (hero, 180 px +): secondary detail that reads only when big (rifle sling, ports, lifeboats, steps)
// `lod: 'auto'` picks from the on-screen height. Every sign is ONE Path2D filled 'nonzero': solids wind clockwise and the
// cuts counter-clockwise, so cut-outs show whatever is underneath (paper, a flat, a map) and nothing needs a second ink.
//
//   import { sign, row, SIGNS } from '../lib/fx/signs.js';
//   g.fillStyle = ink;  sign(g, 'soldier', x, footY, 120);               // x = centre, y = baseline, height in px
//   row(g, 'base', 75, { x: 80, y: 1500, h: 40, perRow: 15, gap: 0.25 }); // an Isotype count: 75 signs, 15 per row
//   signPath('ship', 2) -> { path, w } in grid units (baseline y = 0, up is -y)
// Signs: soldier, worker, factory, ship, bow (a liner head-on), base, home, rent, bank, coin, train, pylon, bridge, crane, rails.
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- winding-aware builders
class B {
  constructor() { this.p = new Path2D(); }
  // solid (clockwise in canvas coords) / cut (counter-clockwise)
  R(x, y, w, h, cut = false) { const p = this.p; if (!cut) { p.moveTo(x, y); p.lineTo(x + w, y); p.lineTo(x + w, y + h); p.lineTo(x, y + h); } else { p.moveTo(x, y); p.lineTo(x, y + h); p.lineTo(x + w, y + h); p.lineTo(x + w, y); } p.closePath(); return this; }
  C(x, y, r, cut = false) { this.p.moveTo(x + r, y); this.p.arc(x, y, r, 0, TAU, cut); this.p.closePath(); return this; }
  E(x, y, rx, ry, cut = false, a0 = 0, a1 = TAU) { this.p.moveTo(x + rx * Math.cos(a0), y + ry * Math.sin(a0)); this.p.ellipse(x, y, rx, ry, 0, a0, a1, cut); this.p.closePath(); return this; }
  // polygon: orientation fixed from its signed area
  P(pts, cut = false) { let a = 0; for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; }
    const cw = a > 0; const q = (cw !== cut) ? pts : [...pts].reverse(); q.forEach(([x, y], i) => i ? this.p.lineTo(x, y) : this.p.moveTo(x, y)); this.p.closePath(); return this; }
  // a member from (x0,y0) to (x1,y1) of width w (a thin quad: lattice, rifles, masts, braces)
  S(x0, y0, x1, y1, w, cut = false) { const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L * w / 2, ny = dx / L * w / 2;
    return this.P([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], cut); }
  star(x, y, r, cut = false) { const pts = []; for (let k = 0; k < 10; k++) { const rr = k % 2 ? r * 0.4 : r, a = -Math.PI / 2 + k * Math.PI / 5; pts.push([x + rr * Math.cos(a), y + rr * Math.sin(a)]); } return this.P(pts, cut); }
}

// ---------------------------------------------------------------- the family (grid units: baseline y = 0, height ~100)
const DEF = {
  // a soldier, front, at attention: M1 helmet, rifle at the shoulder (lod 1), belt and boots (lod 2)
  soldier: { w: 46, f(b, l) {
    b.E(23, -84, 12.5, 11, false, Math.PI, TAU); b.R(9, -85, 28, 3.6);          // the M1 dome and its rim
    b.C(23, -78, 7.2);                                                          // the face under the rim
    b.P([[8, -70], [38, -70], [35, -36], [11, -36]]);                           // tunic
    b.R(2, -69, 5.6, 31); b.R(39, -69, 5.6, 31);                                // arms at the sides
    b.R(12, -37, 9.4, 37); b.R(24.6, -37, 9.4, 37);                             // legs
    if (l >= 1) { b.S(42, -36, 47, -104, 3.4); b.R(10.5, -46, 25, 2.6, true); }  // the rifle; the belt cut
    if (l >= 2) { b.R(11, -4, 10, 4); b.R(25, -4, 10, 4); b.R(16, -63, 14, 2, true); b.C(23, -55, 1.3, true); b.C(23, -49, 1.3, true); }   // boots, collar, buttons
  } },
  // a worker, front: flat cap, hammer on the shoulder (lod 1), apron line (lod 2)
  worker: { w: 46, f(b, l) {
    b.C(23, -80, 7.6); b.E(23, -86, 10, 5.2, false, Math.PI, TAU); b.R(13, -86.4, 22, 3); b.R(23, -86.4, 14, 2.6);   // head, cap and its peak
    b.P([[8, -70], [38, -70], [35, -36], [11, -36]]); b.R(2, -69, 5.6, 31); b.R(39, -69, 5.6, 31); b.R(12, -37, 9.4, 37); b.R(24.6, -37, 9.4, 37);
    if (l >= 1) { b.S(41, -62, 46, -100, 3.4); b.R(38, -106, 17, 8); }           // the hammer over the shoulder
    if (l >= 2) { b.P([[14, -60], [32, -60], [31, -38], [15, -38]], true); b.P([[16, -58], [30, -58], [29.2, -40], [16.8, -40]]); }   // the bib apron's edge
  } },
  // a mill: a sawtooth shed and two stacks; windows (lod 1); the stacks' bands and a door (lod 2)
  factory: { w: 112, f(b, l) {
    b.R(0, -34, 112, 34);
    for (let k = 0; k < 4; k++) { const x = 4 + k * 20; b.P([[x, -34], [x, -54], [x + 20, -34]]); }
    b.R(86, -86, 10, 52); b.R(100, -74, 9, 40);
    if (l >= 1) for (let k = 0; k < 5; k++) b.R(6 + k * 16, -25, 9, 12, true);
    if (l >= 2) { b.R(86, -80, 10, 3, true); b.R(100, -68, 9, 3, true); b.R(90, -18, 12, 18, true); for (let k = 0; k < 4; k++) { const x = 4 + k * 20; b.S(x + 2, -36, x + 2, -50, 1.4, true); } }
  } },
  // a troopship side-on: sheer and raked bow, three decks of superstructure, a raked funnel, two masts;
  // ports (lod 1); the men at her rails as a row of heads, lifeboats, the funnel band (lod 2)
  ship: { w: 300, f(b, l) {
    b.P([[0, -26], [8, 0], [284, 0], [302, -42], [262, -32], [140, -29], [40, -28]]);   // hull, sheer rising to the bow
    b.R(70, -48, 140, 21); b.R(88, -63, 100, 16); b.R(108, -76, 54, 14);           // superstructure tiers
    b.P([[120, -75], [142, -75], [148, -110], [128, -110]]);                          // the funnel, raked aft
    b.S(42, -28, 38, -98, 3); b.S(238, -31, 234, -104, 3); b.R(34, -86, 12, 2.4); b.R(230, -92, 12, 2.4);   // masts and yards
    if (l >= 1) for (let x = 22; x < 270; x += 13) b.C(x, -14 + (x - 22) * -0.03, 2.4, true);
    if (l >= 1) for (let x = 76; x < 206; x += 11) b.R(x, -43, 5.5, 4.5, true);
    if (l >= 2) { b.R(123.5, -100, 21.5, 4, true); for (let x = 12; x < 66; x += 5) b.C(x, -31.5, 2.1); for (let x = 216; x < 262; x += 5) b.C(x, -34.5, 2.1);
      for (const x of [96, 124, 152, 176]) b.E(x, -52.5, 8.5, 2.6); }
  } },
  // an overseas base: a long barracks under a gable, the flag on its pole above the ridge; the star and the doors cut
  // (lod 1); windows (lod 2). (A dome with a pole read as a musical note in a row: the gable and the flag do not.)
  base: { w: 100, f(b, l) {
    b.R(4, -24, 92, 24); b.P([[0, -22], [50, -38], [100, -22]]); b.R(48, -96, 4, 62); b.R(52, -96, 30, 20);
    if (l >= 1) { b.star(67, -86, 6, true); b.R(44, -15, 12, 15, true); }
    if (l >= 2) { for (const x of [12, 26, 66, 80]) b.R(x, -17, 8, 7, true); b.R(52, -81, 30, 2, true); }
  } },
  // a home: house, roof, chimney; the door and a window cut (lod 1); the window's bars (lod 2)
  home: { w: 64, f(b, l) {
    b.R(7, -38, 50, 38); b.P([[0, -36], [32, -66], [64, -36]]); b.R(44, -64, 8, 18);
    if (l >= 1) { b.R(26, -22, 12, 22, true); b.R(11, -30, 11, 10, true); b.R(42, -30, 11, 10, true); }
    if (l >= 2) { b.R(16, -30, 1.6, 10); b.R(47, -30, 1.6, 10); b.R(11, -25.8, 11, 1.6); b.R(42, -25.8, 11, 1.6); }
  } },
  // rent: the house with its door replaced by the landlord's lock (a keyhole), and the rent roll nailed up (lod 1)
  rent: { w: 64, f(b, l) {
    b.R(7, -38, 50, 38); b.P([[0, -36], [32, -66], [64, -36]]); b.R(44, -64, 8, 18);
    b.C(32, -21, 6, true); b.P([[28.4, -18], [35.6, -18], [37.5, -5], [26.5, -5]], true);
    if (l >= 1) { b.R(11, -32, 11, 14, true); b.R(13, -29, 7, 1.6); b.R(13, -25.5, 7, 1.6); b.R(13, -22, 5, 1.6); }
  } },
  // a bank: temple front, pediment, columns, stylobate; the pediment's tympanum cut (lod 1); six columns (lod 2)
  bank: { w: 96, f(b, l) {
    b.P([[0, -74], [48, -96], [96, -74]]); b.R(0, -74, 96, 9);
    const cols = l >= 2 ? 6 : 4, cw = l >= 2 ? 8 : 10.5;
    for (let k = 0; k < cols; k++) b.R(6 + k * (84 - cw) / (cols - 1), -64, cw, 54);
    b.R(-3, -10, 102, 5); b.R(-7, -5, 110, 5);
    if (l >= 1) b.P([[16, -76], [48, -90], [80, -76]], true);
  } },
  // a coin: disc; the rim cut (lod 1); the face's star (lod 2)
  coin: { w: 44, f(b, l) {
    b.C(22, -22, 22); if (l >= 1) { b.C(22, -22, 18.5, true); b.C(22, -22, 16); } if (l >= 2) b.star(22, -22, 9, true);
  } },
  // a locomotive: boiler, smokebox, chimney, cab, three drivers and a pilot; wheel hubs and the cab window (lod 1)
  train: { w: 150, f(b, l) {
    b.R(14, -48, 78, 26); b.C(14, -35, 13); b.R(18, -64, 11, 16); b.E(54, -48, 9, 7, false, Math.PI, TAU);
    b.R(92, -64, 32, 44); b.R(88, -66, 40, 4); b.R(4, -23, 126, 7);
    b.P([[0, -16], [12, -23], [12, -8]]);
    for (const x of [44, 70, 96]) b.C(x, -11, 11); b.C(118, -8, 8);
    if (l >= 1) { b.R(100, -58, 16, 14, true); for (const x of [44, 70, 96]) b.C(x, -11, 4, true); b.C(118, -8, 3, true); }
    if (l >= 2) { b.S(44, -11, 96, -11, 3); b.R(30, -48, 3, 26, true); b.R(60, -48, 3, 26, true); }
  } },
  // a transmission pylon: two legs, two arms, cross bracing; insulators (lod 1)
  pylon: { w: 64, f(b, l) {
    const lg = l ? 4 : 6; b.S(8, 0, 28, -100, lg); b.S(56, 0, 36, -100, lg); b.R(0, -82, 64, l ? 4 : 6); b.R(6, -62, 52, l ? 4 : 6); b.R(26, -104, 12, 6);
    const lv = [[-10, -34], [-34, -62]]; for (const [y0, y1] of lv) { const xl = y => 8 + (28 - 8) * (-y / 100), xr = y => 56 - 20 * (-y / 100); b.S(xl(y0), y0, xr(y1), y1, l ? 2.4 : 4); b.S(xr(y0), y0, xl(y1), y1, l ? 2.4 : 4); }
    if (l >= 1) for (const x of [2, 62, 9, 55]) { const y = x === 2 || x === 62 ? -78 : -58; b.R(x - 1.5, y, 3, 9); }
  } },
  // a cantilever bridge: deck, two trusses rising over the piers, verticals; the truss panels cut (lod 1)
  bridge: { w: 220, f(b, l) {
    b.R(0, -24, 220, 6); b.R(50, -18, 10, 18); b.R(160, -18, 10, 18);
    const top = x => -24 - 44 * Math.max(0, 1 - Math.abs(x - 55) / 55) - 44 * Math.max(0, 1 - Math.abs(x - 165) / 55);
    const pts = []; for (let x = 0; x <= 220; x += 10) pts.push([x, top(x)]);
    for (let i = 0; i < pts.length - 1; i++) b.S(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 5);
    for (let x = 10; x < 220; x += 10) { b.S(x, -24, x, top(x), 2.6); if (l >= 1 && x % 20 === 10) b.S(x, -24, x + 10, top(x + 10), 2); }
  } },
  // a tower crane: mast, jib, counter-jib, hook
  crane: { w: 120, f(b, l) {
    b.R(30, -110, 8, 110); b.R(0, -112, 120, 5); b.R(4, -107, 20, 9); b.P([[30, -112], [34, -126], [38, -112]]);
    b.S(34, -126, 116, -112, 1.8); b.S(34, -126, 4, -112, 1.8); b.R(96, -107, 1.6, 40); b.R(92, -67, 9, 6);
    if (l >= 1) for (let y = -104; y < -6; y += 10) b.S(30, y, 38, y + 10, 1.6, true);
  } },
  // a liner head-on from the waterline (Cassandre, Normandie 1935): the stem, the flared bow, superstructure and three
  // funnels stepping back; hawse pipes and the anchor (lod 1); port rows following the flare (lod 2). A hero sign.
  bow: { w: 160, f(b, l) {
    const side = []; for (let k = 0; k <= 12; k++) { const v = k / 12, y = -v * 66, x = 80 - 72 * Math.pow(v, 0.75); side.push([x, y]); }
    b.P([...side, [80, -70], ...side.map(([x, y]) => [160 - x, y]).reverse()]);
    b.R(30, -80, 100, 11); b.R(44, -90, 72, 11); b.R(58, -98, 44, 9);
    for (const [x, w, h] of [[66, 14, 22], [73, 16, 30], [80, 18, 36]]) b.P([[x - w / 2, -96], [x + w / 2, -96], [x + w / 2 - 1.5, -96 - h], [x - w / 2 + 1.5, -96 - h]]);
    if (l >= 1) { b.E(64, -54, 4.2, 3, true); b.E(96, -54, 4.2, 3, true); b.S(64, -51, 63, -40, 2.2, true); b.R(78.9, -66, 2.2, 66, true); b.R(36, -77, 88, 2, true); }
    if (l >= 2) for (const v of [0.62, 0.78]) { const y = -v * 66, x = 80 - 72 * Math.pow(v, 0.75); for (let u = 0.12; u < 0.9; u += 0.11) { b.C(x + (80 - x) * u, y + 1.5, 1.4, true); b.C(160 - x - (80 - x) * u, y + 1.5, 1.4, true); } }
  } },
  // rails in perspective toward a vanishing point: two rails and sleepers (a row sign for "more rails")
  rails: { w: 100, f(b, l) {
    b.P([[0, 0], [10, 0], [46, -100], [44, -100]]); b.P([[90, 0], [100, 0], [56, -100], [54, -100]]);
    for (let k = 0; k < (l ? 9 : 5); k++) { const v = Math.pow(k / (l ? 9 : 5), 1.6), y = -v * 100, hw = 50 - v * 42; b.R(50 - hw - 4, y - 3 + v * 2, 2 * hw + 8, Math.max(1.4, 5 * (1 - v))); }
  } },
};
export const SIGNS = Object.keys(DEF);
const CACHE = new Map();
export function signPath(name, lod = 1) {
  const key = name + lod; let v = CACHE.get(key); if (v) return v;
  const d = DEF[name]; if (!d) throw new Error('signs: no sign ' + name);
  const b = new B(); d.f(b, lod); v = { path: b.p, w: d.w }; CACHE.set(key, v); return v;
}
export const lodFor = hPx => hPx < 48 ? 0 : hPx < 180 ? 1 : 2;
// draw a sign: x = centre, y = baseline, h = on-screen height of the 100-unit grid. flip mirrors it. Uses g's fillStyle
// unless `style` is given. Returns the drawn width in px.
export function sign(g, name, x, y, h, { lod = 'auto', flip = false, style = null, rot = 0 } = {}) {
  const l = lod === 'auto' ? lodFor(h) : lod, { path, w } = signPath(name, l), k = h / 100;
  g.save(); g.translate(x, y); if (rot) g.rotate(rot); g.scale(flip ? -k : k, k); g.translate(-w / 2, 0); if (style) g.fillStyle = style; g.fill(path); g.restore();
  return w * k;
}
// an Isotype count: n signs in rows of perRow, left-aligned at (x, y = first baseline), each h tall; gap = space between
// signs as a fraction of the sign width; rows step down by h * (1 + lead). A fractional last sign is cut (Neurath's rule).
export function row(g, name, n, { x = 60, y = 200, h = 40, perRow = 10, gap = 0.2, lead = 0.25, lod = 'auto', style = null, each = null } = {}) {
  const l = lod === 'auto' ? lodFor(h) : lod, { w } = signPath(name, l), sw = w * h / 100, step = sw * (1 + gap);
  const whole = Math.floor(n), frac = n - whole;
  for (let i = 0; i < Math.ceil(n); i++) {
    const cx = x + (i % perRow) * step + sw / 2, cy = y + Math.floor(i / perRow) * h * (1 + lead);
    if (each) each(i, cx, cy);
    if (i === whole && frac > 0) { g.save(); g.beginPath(); g.rect(cx - sw / 2 - 1, cy - h * 1.3, sw * frac + 1, h * 1.4); g.clip(); sign(g, name, cx, cy, h, { lod: l, style }); g.restore(); }
    else sign(g, name, cx, cy, h, { lod: l, style });
  }
  return { w: Math.min(n, perRow) * step, h: Math.ceil(n / perRow) * h * (1 + lead) };
}

// a sign leaving the print way: cut into horizontal bands that thin as p goes 0 -> 1 (pitch in px on screen)
export function signOut(g, name, x, y, h, p, { pitch = 9, ...o } = {}) {
  if (p >= 1) return 0; if (p <= 0) return sign(g, name, x, y, h, o);
  const l = o.lod === undefined || o.lod === 'auto' ? lodFor(h) : o.lod, { w } = signPath(name, l), sw = w * h / 100, band = new Path2D();
  for (let yy = y - h * 1.3; yy < y + pitch; yy += pitch) band.rect(x - sw, yy, sw * 2, pitch * (1 - p));
  g.save(); g.clip(band); const r = sign(g, name, x, y, h, o); g.restore(); return r;
}
