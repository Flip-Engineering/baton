// CIVILIZATION v15: the events on the one globe, as a function of the beat. draw(V, WD, beat, t) paints the ground, then every event whose time it is.
import * as K from './empire5.kit.js';
import * as D from './civ.draw.js';
import { drawGround, drawUS, drawManhattan, drawLakes } from './civ.draw.js';
import { TOWNS, PLANTS, PAIRS, METROS, SITES, SITE, EUROPE_SITES, WALLST, CBANKS, CAN_CITIES } from './civ.data.js';
import { geoInterpolate, geoDistance } from 'd3-geo';
const { g, P, RED, BLK, GOLD, PAPER, TAU, k, r, d, clamp, lerp, ease, rng } = K;

const sm = (b, a, z) => clamp((b - a) / (z - a));
const WS = WALLST.ll;
const vis = p => p && p[2];

// ---------------------------------------------------------------- the sites: present from `on` to `off`
const HOOK = new Set(EUROPE_SITES.map(s => s.i));
const WIN = { eu: [20.7, 23.4], asia: [24.3, 27.9], rest: [27.6, 28.2] };
const grp = cl => ['DE', 'IT', 'UK', 'ES', 'PT', 'BE', 'NL', 'GR', 'TR', 'RO', 'PL', 'XK', 'BG', 'HU', 'IS', 'GL', 'GULF', 'ME', 'AF'].includes(cl) ? 'eu' : ['JP', 'KR', 'GU', 'PH', 'SEA', 'AU', 'PAC', 'IO'].includes(cl) ? 'asia' : 'rest';
export function init(WD) {
  SITES.forEach(s => { const w = WIN[grp(s.cl)]; s.on = HOOK.has(s.i) ? -1 : lerp(w[0], w[1], s.h); s.off = 38.5 + 8.4 * ((s.h * 7.31) % 1); });   // c20: all home by b47
}
const siteAge = (s, beat) => beat - s.on;
const nowSites = beat => SITES.filter(s => beat >= s.on && beat < s.off);
export const countAt = beat => nowSites(beat).length;

// ---------------------------------------------------------------- shipments: things that ride an arc, out and home
// soldiers: [home town, base, launch beat, duration]; the first four are the pairs the piece comes back to
const SOLD = [
  ['AKRON', 'AVIANO'], ['RICHMOND', 'RAMSTEIN'], ['BUFFALO', 'NSA BAHRAIN'], ['OKLAHOMA CITY', 'KADENA'],
  ['NORFOLK', 'ROTA'], ['NORFOLK', 'LAKENHEATH'], ['CHARLOTTE', 'STUTTGART'], ['ATLANTA', 'INCIRLIK'], ['MIAMI', 'SOTO CANO'], ['DALLAS', 'AL UDEID'],
  ['HOUSTON', 'ARIFJAN'], ['DENVER', 'DIEGO GARCIA'], ['CHICAGO', 'SPANGDAHLEM'], ['BOSTON', 'LAJES'], ['PHILADELPHIA', 'NAPLES'], ['PITTSBURGH', 'VICENZA'],
  ['DETROIT', 'GRAFENWOHR'], ['INDIANAPOLIS', 'SIGONELLA'], ['MINNEAPOLIS', 'KEFLAVIK'], ['KANSAS CITY', 'LEMONNIER'], ['MILWAUKEE', 'SOUDA BAY'],
  ['LOS ANGELES', 'YOKOSUKA'], ['SAN DIEGO', 'HUMPHREYS'], ['SEATTLE', 'MISAWA'], ['PORTLAND', 'ANDERSEN'], ['SAN FRANCISCO', 'KWAJALEIN'], ['PHOENIX', 'OSAN'], ['LAS VEGAS', 'KUNSAN'],
];
const NAMEFIX = { 'NSA BAHRAIN': 'BAHRAIN' };
const siteLL = n => (SITE[NAMEFIX[n] || n] || SITE[n]).ll;
export const SHIPS = [];
SOLD.forEach(([town, base], i) => {
  const A = TOWNS[town], Bb = siteLL(base), west = Bb[0] > 60;
  const pair = i < 4 ? i : -1;
  const t0 = pair >= 0 ? [20.3, 20.7, 21.4, 24.6][pair] : west ? 24.4 + 0.12 * (i - 20) : 20.4 + 0.1 * (i - 4);
  SHIPS.push({ kind: 'helmet', town, base, A, B: Bb, t0, dur: 1.5 + 0.35 * geoDistance(A, Bb), pair, home: null });
});
PLANTS.forEach((p, i) => SHIPS.push({ kind: 'plant', town: p.town, base: p.to, A: TOWNS[p.town], B: p.toll, t0: 16.4 + 0.24 * i, dur: 3.3, pair: -1 }));
// the way home: soldiers come in as the arcs reverse (b38.3-50), plants at b50.4
SHIPS.forEach((s, i) => {
  if (s.kind === 'plant') { s.r0 = 46.2 + 0.15 * (i - SOLD.length); s.rd = 1.8; }          // c20: the plants come home lit as the last soldiers land
  else if (s.pair >= 0) { s.r0 = [42.2, 44.0, 44.7, 45.3][s.pair]; s.rd = [1.5, 1.0, 0.9, 0.9][s.pair]; }   // AVIANO TO AKRON said; the rest land faster
  else { s.r0 = 38.5 + 3.0 * ((i * 0.6180339) % 1); s.rd = 1.5; }
});
const posOf = s => s.kind === 'plant' ? (s.r0 < 99 ? null : null) : null;
// progress along the arc 0 (town) .. 1 (base) at a beat; out ease and home ease
function prog(s, beat) {
  if (beat < s.t0) return 0;
  if (beat < s.t0 + s.dur) return ease.inOutCubic(sm(beat, s.t0, s.t0 + s.dur));
  if (beat < s.r0) return 1;
  if (beat < s.r0 + s.rd) return 1 - ease.inOutCubic(sm(beat, s.r0, s.r0 + s.rd));
  return 0;
}
const state = (s, beat) => beat < s.t0 ? 'wait' : beat < s.t0 + s.dur ? 'out' : beat < s.r0 ? 'away' : beat < s.r0 + s.rd ? 'home' : 'back';

function drawShip(V, s, beat, o = {}) {
  const st = state(s, beat); if (st === 'wait') return;
  const u = prog(s, beat), h = s.kind === 'plant' ? 0.04 + 0.1 * geoDistance(s.A, s.B) : null;
  const w = s.kind === 'plant' ? 7 : s.pair === 0 && beat > 38 ? 9 : 5;
  if (st === 'out' || st === 'home') {
    const pts = V.arc(s.A, s.B, { u0: 0, u1: u, n: 48, h });
    if (pts.length > 1) D.strokeArc(pts, { w });
    const head = V.arcPoint(s.A, s.B, u, h);
    if (vis(head)) {
      if (s.kind === 'plant') D.plantIcon(head[0], head[1] - 6, o.ps ?? 22, { lit: st === 'home', casing: true });
      else D.m1(head[0], head[1], s.pair === 0 && beat > 38 ? 34 : (o.hs ?? 17), r(1));
    }
  } else if (st === 'away') {
    if (beat >= 34 && beat < 38) return;                      // the seizure and the silence: the orders' lines are gone
    const pts = V.arc(s.A, s.B, { n: 48, h }); D.strokeArc(pts, { w: 2.6 });
    const head = V.arcPoint(s.A, s.B, 1, h);
  }
}

// ---------------------------------------------------------------- the hook: Europe, garrisoned
function roundelsAt(V, beat, o = {}) {
  const R = V.cam.R, base = clamp(0.3 * Math.sqrt(R), 7, 19);
  for (const s of SITES) {
    if (beat < s.on || beat >= s.off) continue;
    const p = V.pt(s.ll); if (!p[2] || p[3] < 0.05) continue;
    if (p[0] < -30 || p[0] > 1110 || p[1] < -30 || p[1] > 1950) continue;
    // c20: a base is a helmet (D.m1), set down: it drops a little into place, no overshoot, no ring
    const age = beat - s.on, pop = s.on < 0 ? 1 : ease.outCubic(clamp(age / 0.25));
    const vanish = beat > s.off - 0.35 ? clamp(1 - (beat - (s.off - 0.35)) / 0.35) : 1;
    const sz = base * (s.name ? 1.08 : 0.92) * (o.k ?? 1) * vanish * (0.4 + 0.6 * pop);
    if (pop > 0 && sz > 0.3) D.m1(p[0], p[1] - (1 - pop) * 22, sz, r(1));
  }
}
// the velvet rope across the German cluster: paper posts, a sagging paper cord, one pinned placard
// c20: a museum's stanchions, standing up off the map across the south of the garrison (the Alps line), the cord hung between their tops;
// paper posts with black caps, a heavy black cord in a paper casing (v20's dotted thread didn't read as a rope at phone size)
const ROPE = [[1.5, 47.0], [4.4, 47.3], [7.3, 47.5], [10.2, 47.4], [13.1, 47.3], [16.0, 47.6], [18.9, 47.9]];
function rope(V, beat) {
  const t0 = 3.9, P0 = ROPE.map(ll => V.pt(ll)), n = P0.length, Hp = 92 * clamp(V.cam.R / 2300, 0.6, 1.6);
  const up = i => ease.outCubic(clamp((beat - (t0 + 0.07 * i)) / 0.22));
  const top = (a, i) => [a[0], a[1] - Hp * up(i)];
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i < n; i++) {                                                 // the posts: base plate, shaft, ball cap
    const a = P0[i], u = up(i); if (u <= 0) continue; const t = top(a, i);
    g.fillStyle = PAPER; g.beginPath(); g.ellipse(a[0], a[1], 22, 9, 0, 0, TAU); g.fill();
    g.fillStyle = k(1); g.beginPath(); g.ellipse(a[0], a[1], 16, 6, 0, 0, TAU); g.fill();
    g.strokeStyle = k(1); g.lineWidth = 16; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(t[0], t[1]); g.stroke();
    g.strokeStyle = PAPER; g.lineWidth = 8; g.beginPath(); g.moveTo(a[0], a[1] - 4); g.lineTo(t[0], t[1]); g.stroke();
  }
  for (let i = 0; i < n - 1; i++) {                                             // the cord: hung, swinging in, then still
    const u = clamp((beat - (t0 + 0.07 * i + 0.12)) / 0.35); if (u <= 0 || up(i) < 1 && up(i + 1) <= 0) continue;
    const a = top(P0[i], i), b = top(P0[i + 1], i + 1), sag = 46 * u + 10 * Math.sin(u * Math.PI * 2) * (1 - u);
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + sag * 2;
    for (const [col, w] of [[PAPER, 22], [k(1), 12]]) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo(mx, my, b[0], b[1]); g.stroke(); }
  }
  for (let i = 0; i < n; i++) { const u = up(i); if (u <= 0) continue; const t = top(P0[i], i); g.fillStyle = PAPER; g.beginPath(); g.arc(t[0], t[1], 15, 0, TAU); g.fill(); g.fillStyle = k(1); g.beginPath(); g.arc(t[0], t[1], 10, 0, TAU); g.fill(); }
}

// ---------------------------------------------------------------- gold: money's orders, from one point
function goldLine(pts, w = 5) {
  D.strokeArc(pts, { w, col: d(1), casing: true });
}
function wallMark(V, beat, o = {}) {
  const p = V.pt(WS); if (!vis(p)) return;
  const big = o.r ?? 12;
  g.fillStyle = PAPER; g.beginPath(); g.arc(p[0], p[1], big + 6, 0, TAU); g.fill();
  g.fillStyle = d(1); g.beginPath(); g.arc(p[0], p[1], big, 0, TAU); g.fill();
  g.strokeStyle = k(1); g.lineWidth = 4; g.beginPath(); g.arc(p[0], p[1], big, 0, TAU); g.stroke();
}
function orderRings(V, beat, b0, b1, rmax = 260) {
  const p = V.pt(WS); if (!vis(p)) return;
  for (let j = 0; j < 3; j++) {
    const u = ((beat - b0) * 1 + j / 3) % 1; if (beat < b0 || beat > b1) continue;
    g.strokeStyle = d(1); g.lineWidth = 8 * (1 - u) + 2; g.beginPath(); g.arc(p[0], p[1], 20 + u * rmax, 0, TAU); g.stroke();
  }
}
function wallStreet(V, beat) {
  // the label lies along the street, on the real grid
  const segs = (V.cam.R > 1.5e6) ? WSEG : null; if (!segs) return;
  const a = V.pt(segs[0]), b = V.pt(segs[1]);
  let ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, u = ease.outBack(clamp((beat - 10.9) / 0.35));
  if (u <= 0) return;
  g.save(); g.translate(mx, my); g.rotate(ang); g.scale(u, u);
  const size = 100, tw = D.textW('WALL ST', size), bw = tw + 40, bh = size * 0.92 + 28;
  g.fillStyle = PAPER; g.fillRect(-bw / 2, -bh / 2, bw, bh);
  g.strokeStyle = k(1); g.lineWidth = 5; g.strokeRect(-bw / 2, -bh / 2, bw, bh);
  g.fillStyle = k(1); g.font = `${size}px "Anton"`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText('WALL ST', 0, bh / 2 - 14 - size * 0.04);
  g.restore();
}
let WSEG = null;
export function setWallSeg(a, b) { WSEG = [a, b]; }

// ---------------------------------------------------------------- helpers
const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const pinTag = (V, ll, text, o = {}) => { const p = V.pt(ll); if (!p[2] || p[0] < -60 || p[0] > 1140 || p[1] < -60 || p[1] > 1980) return null; D.tag(text, p[0], p[1], o); return p; };
const townDot = (V, n, col = r(1), s = 9) => { const p = V.pt(TOWNS[n]); if (vis(p)) D.dotMark(p[0], p[1], s, col); return p; };

// ---------------------------------------------------------------- b12-16: the rents run to one point
function rents(V, beat) {
  if (beat < 12.6 || beat >= 16.0) return;
  const grow = ease.inOutCubic(sm(beat, 12.8, 16.4)), fade = 1;
  METROS.forEach((m, i) => {
    const A = TOWNS[m], pts = V.arc(A, WS, { h: 0.02 + 0.04 * geoDistance(A, WS), n: 40 });
    D.strokeArc(pts, { w: 4, col: d(1), casing: true });
    const n = 1 + Math.floor(grow * 4.5);
    for (let j = 0; j < n; j++) {
      const s = (beat * 0.55 + hash(i) + j / n) % 1, p = V.arcPoint(A, WS, 1 - s, 0.02 + 0.04 * geoDistance(A, WS));
      if (vis(p)) { g.fillStyle = PAPER; g.beginPath(); g.arc(p[0], p[1], 11, 0, TAU); g.fill(); g.fillStyle = d(1); g.beginPath(); g.arc(p[0], p[1], 7.5, 0, TAU); g.fill(); }
    }
    const p = V.pt(A); if (vis(p)) { g.fillStyle = PAPER; g.beginPath(); g.arc(p[0], p[1], 11, 0, TAU); g.fill(); g.fillStyle = k(1); g.beginPath(); g.arc(p[0], p[1], 5, 0, TAU); g.fill(); }
  });
  const p = V.pt(WS); if (vis(p)) {
    const rr = lerp(9, 40, grow);
    g.fillStyle = PAPER; g.beginPath(); g.arc(p[0], p[1], rr + 7, 0, TAU); g.fill();
    g.fillStyle = d(1); g.beginPath(); g.arc(p[0], p[1], rr, 0, TAU); g.fill();
    g.strokeStyle = k(1); g.lineWidth = 4; g.beginPath(); g.arc(p[0], p[1], rr, 0, TAU); g.stroke();
  }
  if (beat > 13.6) {
    D.tag('NEW YORK', p[0], p[1], { side: 'd', size: 52, gap: 64, dx: -30, ink: 'k' });
  }
}

// ---------------------------------------------------------------- b16-20: the plants and the soldiers on their arcs
const PLANT_TAGS = { AKRON: ['r', 0, 18], DETROIT: ['l', 0, -10], FLINT: ['u', 0, -16], TOLEDO: ['l', 0, 20], GARY: ['l', 0, 0], BUFFALO: ['r', 0, -26] };
function plantsHome(V, beat) {                                 // the plants standing in their towns (lit, red) before they go, and again once they are back
  PLANTS.forEach((pl, i) => {
    const s = SHIPS.find(x => x.kind === 'plant' && x.town === pl.town), st = state(s, beat), p = V.pt(TOWNS[pl.town]);
    if (!vis(p)) return;
    const scale = V.cam.R > 3000 ? clamp(V.cam.R / 190, 24, 60) : 16;
    if (st === 'wait' || st === 'back') {
      const lit = st === 'wait' || beat >= s.r0 + s.rd;
      const drop = st === 'back' ? ease.outBack(clamp((beat - (s.r0 + s.rd)) / 0.35)) : 1;
      if (lit && drop > 0) D.plantIcon(p[0], p[1] - (1 - drop) * 120, scale * drop, { lit: true, casing: true });
    } else {                                                  // the town left behind: a ring, lights out
      g.strokeStyle = k(1); g.lineWidth = 5; g.fillStyle = PAPER; g.beginPath(); g.arc(p[0], p[1], 13, 0, TAU); g.fill(); g.stroke();
    }
  });
}
function ships(V, beat) {
  for (const s of SHIPS) {
    if (s.kind === 'plant') {
      const st = state(s, beat);
      if (st === 'away' && !(beat >= 34 && beat < 38)) { const dp = V.pt(s.B); if (vis(dp)) D.plantIcon(dp[0], dp[1], 24, { lit: false, casing: true }); }
    }
    drawShip(V, s, beat, { ps: V.cam.R > 3000 ? 46 : 40, hs: V.cam.R > 3000 ? 26 : 22 });
  }
}
function lakeTags(V, beat) {
  if (beat < 16.2 || beat >= 19.4) return;
  for (const [n, [side, dx, dy]] of Object.entries(PLANT_TAGS)) {
    const s = SHIPS.find(x => x.kind === 'plant' && x.town === n), st = state(s, beat);
    if (st === 'wait' && beat < 16.3 + 0.1) continue;
    pinTag(V, TOWNS[n], n, { side, dx, dy, size: 54, ink: 'r', gap: 38, lead: true });
  }
}

// ---------------------------------------------------------------- the corner counter and the year
function counter(V, beat) {
  if (beat < 22 || beat >= 49.6) return;
  const n = countAt(beat);
  const y0 = 1605, h = 215, pop = ease.outBack(clamp((beat - 22) / 0.4)) * (1 - ease.inCubic(sm(beat, 48.9, 49.6)));
  g.save(); g.translate(0, (1 - pop) * 300);
  g.fillStyle = PAPER; g.fillRect(30, y0, 440, h); g.strokeStyle = k(1); g.lineWidth = 6; g.strokeRect(30, y0, 440, h);
  g.font = '160px "Anton"'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = r(1); g.fillText(String(n), 48, y0 + 150);
  g.font = '46px "Anton"'; g.fillStyle = k(1); g.fillText('BASES ABROAD', 50, y0 + 202);
  if (beat < 38) {
    // v19 (8 Oct, archive audit section 4): the year no longer runs with the count (1945 -> 2026 beside 0 -> 750 read as 735 bases in 2025,
    // 750 in 2026: steady growth since 1945). The count stamps; the panel holds SINCE 1945, then today's year, STILL HERE.
    g.fillStyle = k(1); g.fillRect(490, y0, 340, h);
    g.fillStyle = PAPER; g.textAlign = 'center';
    if (beat < 28.4) { g.font = '40px "Anton"'; g.fillText('SINCE', 660, y0 + 52); g.font = '130px "Anton"'; g.fillText('1945', 660, y0 + 192); }
    else { g.font = '150px "Anton"'; g.fillText('2026', 660, y0 + 148); g.font = '40px "Anton"'; g.fillText('STILL HERE', 660, y0 + 198); }
  }
  g.restore();
}
function sitesAll(V, beat) {
  // v18: the U.S. TROOPS caption is gone (client: extraneous text)
}

// ---------------------------------------------------------------- b30-37: every order from one point; then the network re-anchors
const SPOKES = [];
SHIPS.forEach(s => { SPOKES.push(s.A); SPOKES.push(s.B); });
const NET = [['RICHMOND', 'DENVER'], ['DENVER', 'KANSAS CITY'], ['KANSAS CITY', 'OKLAHOMA CITY'], ['OKLAHOMA CITY', 'DALLAS'], ['DALLAS', 'HOUSTON'], ['KANSAS CITY', 'CHICAGO'], ['CHICAGO', 'GARY'], ['GARY', 'TOLEDO'],
  ['TOLEDO', 'DETROIT'], ['DETROIT', 'FLINT'], ['TOLEDO', 'AKRON'], ['AKRON', 'CLEVELAND'], ['AKRON', 'YOUNGSTOWN'], ['CLEVELAND', 'BUFFALO'], ['YOUNGSTOWN', 'PITTSBURGH'], ['PITTSBURGH', 'PHILADELPHIA'],
  ['BUFFALO', 'BOSTON'], ['CHICAGO', 'MINNEAPOLIS'], ['CHICAGO', 'MILWAUKEE'], ['ATLANTA', 'CHARLOTTE'], ['ATLANTA', 'DALLAS'], ['PITTSBURGH', 'ATLANTA'], ['SEATTLE', 'PORTLAND'], ['PORTLAND', 'RICHMOND'], ['MINNEAPOLIS', 'DENVER']];
export const TAKE = (typeof window !== 'undefined' && window.CIV_TAKE) || 'a';
// the towns every order runs to: the rents' metros, the plants' towns, the soldiers' home towns
const HOMES = [...new Set([...METROS, ...PLANTS.map(p0 => p0.town), ...SOLD.map(x => x[0])])].map(n => ({ n, ll: TOWNS[n] }));
function hub(V, beat) {
  if (beat < 29.8 || beat >= 34.2) return;
  // b30-34 WE LIVE IN A PLANNED ECONOMY, PLANNED ON WALL STREET: every order drawn out of one point, to the towns and to the bases
  SPOKES.forEach((X, i) => {
    const h = 0.03 + 0.07 * geoDistance(WS, X), u1 = clamp(sm(beat, 30 + 0.012 * i, 31.5));
    if (u1 <= 0) return;
    const pts = V.arc(WS, X, { u0: 0, u1, n: 44, h });
    if (pts.length > 1) D.strokeArc(pts, { w: 3.2, col: d(1), casing: true });
  });
  goldPoint(V, 36);
}
function goldPoint(V, rr) {
  const p = V.pt(WS); if (!vis(p) || rr < 0.5) return p;
  g.fillStyle = PAPER; g.beginPath(); g.arc(p[0], p[1], rr + 7, 0, TAU); g.fill();
  g.fillStyle = d(1); g.beginPath(); g.arc(p[0], p[1], rr, 0, TAU); g.fill();
  g.strokeStyle = k(1); g.lineWidth = 4; g.beginPath(); g.arc(p[0], p[1], rr, 0, TAU); g.stroke();
  return p;
}
// ---------------------------------------------------------------- c20 EXPROPRIATE, take a: the rents run back out
// The gold that ran into the one point at RENTS RISE (b12) runs back out along the same threads, every one at once, to the towns; the
// point drains to nothing; each thread turns red from the town end in; the towns fill. The orders abroad are pulled in and gone.
function seizeA(V, beat) {
  if (beat < 33.9 || beat >= 38.2) return;
  const out = sm(beat, 34.0, 36.1), drain = ease.inOutCubic(sm(beat, 34.15, 36.0)), recall = ease.inOutCubic(sm(beat, 33.95, 34.6));
  SPOKES.forEach((X, i) => {                                         // the orders abroad: pulled back into the point
    if (i % 2 === 0 || recall >= 1) return;
    const h = 0.03 + 0.07 * geoDistance(WS, X), pts = V.arc(WS, X, { u0: 0, u1: 1 - recall, n: 44, h });
    if (pts.length > 1) D.strokeArc(pts, { w: 3.2, col: d(1), casing: true });
  });
  HOMES.forEach((T, i) => {
    const h = 0.02 + 0.04 * geoDistance(T.ll, WS), red = ease.inOutCubic(sm(beat, 34.5 + 0.02 * (i % 9), 36.2 + 0.02 * (i % 9)));
    const all = V.arc(WS, T.ll, { n: 40, h });
    if (all.length > 1) D.strokeArc(all, { w: 4.5, col: d(1), casing: true });
    if (red > 0) { const pr = V.arc(WS, T.ll, { u0: 1 - red, u1: 1, n: 40, h }); if (pr.length > 1) D.strokeArc(pr, { w: 6, col: r(1), casing: true }); }
    if (beat < 36.2) for (let j = 0; j < 4; j++) {                 // the beads, outward: the rents going home
      const u = clamp(out * 1.25 - j * 0.09 - 0.05 * hash(i)); if (u <= 0 || u >= 1) continue;
      const q = V.arcPoint(WS, T.ll, u, h); if (vis(q)) { g.fillStyle = PAPER; g.beginPath(); g.arc(q[0], q[1], 12, 0, TAU); g.fill(); g.fillStyle = d(1); g.beginPath(); g.arc(q[0], q[1], 8.5, 0, TAU); g.fill(); }
    }
    const tp = V.pt(T.ll), got = ease.outCubic(sm(beat, 34.8 + 0.6 * hash(i + 3), 36.0 + 0.4 * hash(i + 3)));
    if (vis(tp)) { g.fillStyle = PAPER; g.beginPath(); g.arc(tp[0], tp[1], 9 + 7 * got, 0, TAU); g.fill(); g.fillStyle = got > 0 ? r(1) : k(1); g.beginPath(); g.arc(tp[0], tp[1], 5 + 7 * got, 0, TAU); g.fill(); }
  });
  const p = goldPoint(V, 36 * (1 - drain));
  if (vis(p) && beat < 35.6) D.tag('WALL ST', p[0], p[1], { side: 'u', size: 54, gap: 70, ink: 'k', alpha: 1 });
}
// ---------------------------------------------------------------- c20 EXPROPRIATE, take b: back down on the street, and it is taken
// The camera drops again to the grid it showed at b8; red comes up every street from both rivers, and people come in along them and
// fill Wall Street until its label is the last paper on the board. People from the person pipeline (SIL profile atlas), flat paper ink.
let STREETSEGS = null;
function streetSegs(WD) {
  if (STREETSEGS) return STREETSEGS;
  const cl = [['hw', WD.streets.hw], ['major', WD.streets.major], ['minor', WD.streets.minor]], out = [];
  for (const [kind, mls] of cl) for (const ln of mls.coordinates) {
    const m = ln[Math.floor(ln.length / 2)], dx = (m[0] - WS[0]) * 84000, dy = (m[1] - WS[1]) * 111000;
    out.push({ kind, ln, d: Math.hypot(dx, dy) });
  }
  return (STREETSEGS = out);
}
// c20 finish: the crowd stands on the map. Each person walks in along a real street near Wall St, from its far end toward the
// exchange, at a size tied to the camera (so the pull-out takes them away with the street), in red ink with a paper keyline.
// (Takes a/b had pale outlines pinned to the screen at the size of a block, walking over the water south of the Battery.)
const TYPES = [0, 2, 3, 6, 7, 11, 12, 13, 15, 17, 19, 23, 26, 27, 29, 31, 32, 34];
let CROWD = null;
function crowdOf(WD) {
  if (CROWD) return CROWD;
  const R = rng(1871), cand = streetSegs(WD).filter(sg => sg.kind !== 'hw' && sg.d > 60 && sg.d < 520 && sg.ln.length >= 2), out = [];
  const dist = q => Math.hypot((q[0] - WS[0]) * 84000, (q[1] - WS[1]) * 111000);
  for (let i = 0; i < 90 && cand.length; i++) {
    const sg = cand[Math.floor(R() * cand.length)], a = sg.ln[0], b = sg.ln[sg.ln.length - 1];
    const [far, near] = dist(a) > dist(b) ? [a, b] : [b, a], stop = 0.55 + 0.45 * R();
    out.push({ from: far, to: [lerp(far[0], near[0], stop), lerp(far[1], near[1], stop)], t0: 34.1 + 1.3 * R(), dur: 1.3 + 0.6 * R(),
      type: TYPES[Math.floor(R() * TYPES.length)], ph: Math.floor(R() * 16), s: 0.85 + 0.3 * R() });
  }
  return (CROWD = out);
}
function seizeB(V, beat, WD) {
  if (beat < 33.9 || beat >= 38.5) return;
  const mpp = V.mpp, lw = m => Math.max(2.4, m / mpp);
  const reach = 1700 * (1 - ease.inOutCubic(sm(beat, 34.0, 36.2)));     // the red front: from the rivers (far) in to the street (near)
  g.lineCap = 'round'; g.strokeStyle = r(1);
  for (const sg of streetSegs(WD)) {
    if (sg.d < reach) continue;
    g.lineWidth = lw(sg.kind === 'hw' ? 32 : sg.kind === 'major' ? 24 : 15); g.beginPath();
    sg.ln.forEach((q, i) => { const pp = V.pt(q); i ? g.lineTo(pp[0], pp[1]) : g.moveTo(pp[0], pp[1]); }); g.stroke();
  }
  // the people: in along the streets toward the exchange; they stop with the band and stay on the street as the camera pulls out
  const hPx0 = 85 * V.cam.R / 2.75e6; if (hPx0 < 5) return;
  const tb = Math.min(beat, 36.4), live = [];
  for (const c of crowdOf(WD)) {
    if (tb < c.t0) continue;
    const u = ease.outCubic(clamp((tb - c.t0) / c.dur)), ll = [lerp(c.from[0], c.to[0], u), lerp(c.from[1], c.to[1], u)], p = V.pt(ll);
    if (!vis(p)) continue;
    const dir = V.pt(c.to)[0] - V.pt(c.from)[0];
    live.push({ c, p, u, flip: dir < 0 });
  }
  live.sort((x, y) => x.p[1] - y.p[1]);
  for (const { c, p, u, flip } of live) {
    const walking = u < 0.98 && beat < 36.4, ph = walking ? (c.ph + Math.floor((tb - c.t0) * 2 * 8.5)) % 16 : 4;
    person(K.SIL_SIDE, c.type, 'walk' + ph, p[0], p[1], hPx0 * c.s, flip, { ink: r(1), line: PAPER, lw: Math.max(2, 3.5 * hPx0 / 100) });
  }
}
// a person from the SIL profile atlas in the piece's flat inks: paper body, a black keyline (o.ink overrides the body)
export function person(S, type, pose, fx, fy, hPx, flip = false, o = {}) {
  if (!S) return null;
  const c = S.cell(type, pose); if (!c) return null;
  const kk = hPx / (S.meta.types[c.type].h * S.meta.PPM), x = fx - c.foot[0] * kk, y = fy - c.foot[1] * kk, path = S.path(c);
  g.save(); if (flip) { g.translate(fx * 2, 0); g.scale(-1, 1); } g.translate(x, y); g.scale(kk, kk);
  g.lineJoin = 'round'; g.strokeStyle = o.line ?? k(1); g.lineWidth = (o.lw ?? 5) / kk; g.stroke(path);
  g.fillStyle = o.ink ?? PAPER; g.fill(path, 'evenodd');
  g.restore();
  return { c, kk, x, y, top: y + c.top * kk, head: [flip ? 2 * fx - (x + c.head[0] * kk) : x + c.head[0] * kk, y + c.head[1] * kk, c.head[2] * kk] };
}
function network(V, beat, b0 = 34.5, b1 = 36.4, o = {}) {
  if (beat < b0) return;
  NET.forEach(([a, b], i) => {
    const u = ease.inOutCubic(sm(beat, b0 + 0.05 * i, b1 + 0.05 * i)); if (u <= 0) return;
    const A = TOWNS[a], Bq = TOWNS[b], pts = V.arc(A, Bq, { u1: u, n: 24, h: 0.01 });
    D.strokeArc(pts, { w: o.w ?? 7, col: r(1), casing: true });
  });
  if (beat > b0 + 0.4) {
    Object.keys(TOWNS).forEach(n => { if (['AKRON', 'RICHMOND', 'BUFFALO', 'OKLAHOMA CITY', 'DETROIT', 'TOLEDO', 'GARY', 'FLINT', 'YOUNGSTOWN', 'CHICAGO', 'DENVER', 'KANSAS CITY', 'DALLAS', 'HOUSTON', 'PITTSBURGH', 'ATLANTA'].includes(n)) { const p = V.pt(TOWNS[n]); if (vis(p)) { g.fillStyle = PAPER; g.beginPath(); g.arc(p[0], p[1], 15, 0, TAU); g.fill(); g.fillStyle = r(1); g.beginPath(); g.arc(p[0], p[1], 9, 0, TAU); g.fill(); } } });
  }
}

// ---------------------------------------------------------------- b42-47: the pairs. AVIANO TO AKRON. is said; the other three land on map tags, faster
function pairs(V, beat) {
  PAIRS.forEach((p, i) => {
    const s0 = SHIPS.find(x => x.pair === i); if (!s0) return;
    const b0 = s0.r0 - 0.2, b1 = s0.r0 + s0.rd + (i === 0 ? 0.3 : 0.5);
    if (beat < b0 || beat >= b1) return;
    const bp = V.pt(p.bll), tp = V.pt(TOWNS[p.town]), sz = i === 0 ? 58 : 46;
    if (beat < s0.r0 + s0.rd * 0.6 && vis(bp)) D.tag(p.base, bp[0], bp[1], { side: 'r', size: sz, gap: 30, ink: 'k' });
    if (vis(tp)) D.tag(p.town, tp[0], tp[1], { side: i === 1 ? 'r' : 'l', size: sz, gap: 30, ink: 'r' });
  });
}

// ---------------------------------------------------------------- c20 b49-57: the second dive, to Akron, where the work is done
// A soldier comes home along E Market St (SIL profile atlas, paper ink), the red M1 still on; it comes off, and under it is the hard
// hat. THE WORKING CLASS BUILDS.: the others come in, and the plant goes up behind them, lit.
const AKJ = [-81.4838, 41.0669];                                   // E Market St at Goodyear Blvd, the old rubber works
export const AKRON_CAM = AKJ;
const HERO = { type: 1, h: 640, x0: -170, x1: 400, fy: 1655 };
const WORKERS = (() => { const R = rng(1936), out = [];          // 1936: the Akron sit-downs
  for (let i = 0; i < 16; i++) { const side = i % 3 === 0 ? 1 : -1, row = R();
    out.push({ side, row, t0: 54.0 + 1.6 * R(), type: [3, 4, 0, 2, 5, 13, 26, 7, 12, 15, 17, 34, 11, 6, 27, 19][i], x1: 250 + 600 * R(), ph: Math.floor(R() * 16) }); }
  return out.sort((a, b) => a.row - b.row); })();
function plantRise(beat) {                                         // the plant: a sawtooth-roofed works going up behind the people
  const u = ease.inOutCubic(sm(beat, 54.1, 55.4)); if (u <= 0) return;
  const x0 = 60, x1 = 1020, base = 1380, Hb = 250, n = 8, bw = (x1 - x0) / n;
  g.save(); g.beginPath(); g.rect(0, base - (Hb + 210) * u, 1080, (Hb + 210) * u + 4); g.clip();
  const body = new Path2D(); body.moveTo(x0, base); body.lineTo(x0, base - Hb);
  for (let i = 0; i < n; i++) { const a = x0 + i * bw; body.lineTo(a + bw * 0.78, base - Hb - 92); body.lineTo(a + bw * 0.78, base - Hb); body.lineTo(a + bw, base - Hb); }
  body.lineTo(x1, base); body.closePath();
  for (const sx of [x0 + bw * 1.3, x0 + bw * 5.6]) body.rect(sx, base - Hb - 210, 34, 210);
  g.strokeStyle = PAPER; g.lineWidth = 14; g.lineJoin = 'round'; g.stroke(body);
  g.fillStyle = k(1); g.fill(body);                              // c20 finish: black on Ohio's red ground (it was red on black)
  g.fillStyle = PAPER;                                             // the north lights (lit glazing in each tooth) and a row of windows
  for (let i = 0; i < n; i++) { const a = x0 + i * bw; g.beginPath(); g.moveTo(a + bw * 0.78 - 8, base - Hb - 80); g.lineTo(a + bw * 0.78 - 8, base - Hb - 4); g.lineTo(a + bw * 0.62, base - Hb - 4); g.closePath(); g.fill(); }
  for (let i = 0; i < 2 * n; i++) g.fillRect(x0 + 22 + i * bw / 2, base - Hb + 70, bw / 2 - 30, 64);
  g.restore();
}
function akronScene(V, beat, WD) {
  D.drawAkron(V, WD.akron);
  streetLabel(V, WD.akron.named['E MARKET ST'], 'AKRON', beat, 50.0, { size: 92, near: AKJ });
  // the people and the plant stand on the street: they scale with the camera, so the pull-out takes them away with the town
  const z = clamp(V.cam.R / 2.33e6, 0, 1.3), A0 = V.pt(AKJ);
  g.save(); g.translate(A0[0], A0[1]); g.scale(z, z); g.translate(-540, -1040);      // (AKJ sits at 540, 1040 in the held frame)
  plantRise(beat);
  const back = WORKERS.filter(w => w.row < 0.5), front = WORKERS.filter(w => w.row >= 0.5);
  const drawW = w => { if (beat < w.t0) return; const u = clamp((beat - w.t0) / 1.6), x = lerp(w.side < 0 ? -120 : 1200, w.x1, ease.outCubic(u)), fy = 1450 + 110 * w.row;
    const ph = u < 0.97 ? (w.ph + Math.floor((beat - w.t0) * 0.5 * 17)) % 16 : 4; person(K.SIL_SIDE, w.type, 'walk' + ph, x, fy, 330 + 170 * w.row, w.side > 0); };
  back.forEach(drawW);
  // the hero: in along the street, stops; the helmet comes off
  const wu = sm(beat, 50.3, 52.5), x = lerp(HERO.x0, HERO.x1, ease.outCubic(wu));
  const ph = wu < 0.995 ? Math.floor((beat - 50.3) * 0.5 * 15) % 16 : 4;
  const fx = x + (beat > 54.4 ? (beat - 54.4) * 60 : 0);
  const hp = person(K.SIL_SIDE, HERO.type, 'walk' + (beat > 54.4 ? Math.floor((beat - 54.4) * 7) % 16 : ph), fx, HERO.fy, HERO.h, false, { lw: 7 });
  if (hp) {
    // c20 finish: the M1 is head-sized and sits on his head over the hard hat (in a/b it was a red dome three heads wide floating
    // clear of him: an umbrella). He takes it off: up off the crown, then down to his side, where he carries it, black (what is gone)
    // on Ohio's red. Under it, the hard hat.
    // (the piece's M1 model is flat for a base mark seen from above; on a head it is drawn 1.4x deep, so the shell covers the hard hat)
    const [hx, hy, hr] = hp.head, s0 = 1.2 * hr, on = [hx + 0.05 * hr, hy + 0.15 * hr];
    const up = ease.inOutCubic(sm(beat, 52.6, 53.1)), down = ease.inOutCubic(sm(beat, 53.1, 53.8));
    const held = [hx + 0.9 * hr, hy + 4.6 * hr];
    const px = lerp(on[0], held[0], down), py = lerp(on[1] - 1.1 * hr * up, held[1], down);
    g.save(); g.translate(px, py); g.scale(1, 1.4 - 0.4 * down);
    D.m1(0, 0, s0 * (1 - 0.12 * down), k(1), { model: D.M1_SIDE, rot: -0.25 * up + 1.3 * down });
    g.restore();
  }
  front.forEach(drawW);
  g.restore();
}
function streetLabel(V, segs, text, beat, b0, { size = 100, near = null } = {}) {
  if (!segs) return;
  let best = null;
  for (const ln of segs) for (let i = 1; i < ln.length; i++) { const m = [(ln[i - 1][0] + ln[i][0]) / 2, (ln[i - 1][1] + ln[i][1]) / 2], dd = Math.hypot(m[0] - near[0], m[1] - near[1]); if (!best || dd < best.dd) best = { a: ln[i - 1], b: ln[i], dd }; }
  const a = V.pt(best.a), b = V.pt(best.b);
  let ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
  const P0 = V.pt(near), u = ease.outBack(clamp((beat - b0) / 0.35)); if (u <= 0) return;
  g.save(); g.translate(P0[0], P0[1] - 120); g.rotate(ang); g.scale(u, u);
  const tw = D.textW(text, size), bw = tw + 40, bh = size * 0.92 + 28;
  g.fillStyle = PAPER; g.fillRect(-bw / 2, -bh / 2, bw, bh); g.strokeStyle = k(1); g.lineWidth = 5; g.strokeRect(-bw / 2, -bh / 2, bw, bh);
  g.fillStyle = k(1); g.font = `${size}px "Anton"`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(text, 0, bh / 2 - 14 - size * 0.04);
  g.restore();
}

// ---------------------------------------------------------------- b56-66: the works between the landing points, the lights, the mark
const LANDINGS = [['RICHMOND', 'OKLAHOMA CITY'], ['OKLAHOMA CITY', 'AKRON'], ['AKRON', 'BUFFALO']];
function ties(pts, gap, len, w = 3) {
  g.strokeStyle = PAPER; g.lineWidth = w; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; if (!a[2] || !b[2]) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (!L) continue;
    const nx = -dy / L, ny = dx / L; let t = gap - acc;
    for (; t < L; t += gap) { const x = a[0] + dx * t / L, y = a[1] + dy * t / L; g.beginPath(); g.moveTo(x - nx * len, y - ny * len); g.lineTo(x + nx * len, y + ny * len); g.stroke(); }
    acc = L - (t - gap);
  }
}
// v18: the works run across the border; plants rise lit in the towns they left and in new ones; the grid ties the provinces to the states
const CANNET = [['SEATTLE', 'VANCOUVER'], ['VANCOUVER', 'CALGARY'], ['CALGARY', 'EDMONTON'], ['CALGARY', 'REGINA'], ['REGINA', 'WINNIPEG'], ['WINNIPEG', 'MINNEAPOLIS'],
  ['WINNIPEG', 'THUNDER BAY'], ['THUNDER BAY', 'SUDBURY'], ['SUDBURY', 'TORONTO'], ['DETROIT', 'WINDSOR'], ['WINDSOR', 'TORONTO'], ['BUFFALO', 'HAMILTON'], ['HAMILTON', 'TORONTO'],
  ['TORONTO', 'OTTAWA'], ['OTTAWA', 'MONTREAL'], ['MONTREAL', 'QUEBEC CITY'], ['MONTREAL', 'BOSTON'], ['QUEBEC CITY', 'HALIFAX'], ['SASKATOON', 'EDMONTON'], ['REGINA', 'SASKATOON']];
const WORKNET = [...NET, ...CANNET];
const GRID = [['RICHMOND', 'OKLAHOMA CITY'], ['OKLAHOMA CITY', 'AKRON'], ['AKRON', 'BUFFALO'], ['QUEBEC CITY', 'BOSTON'], ['MONTREAL', 'PHILADELPHIA'], ['TORONTO', 'BUFFALO'],
  ['VANCOUVER', 'PORTLAND'], ['WINNIPEG', 'CHICAGO'], ['EDMONTON', 'DENVER']];
const NEWPLANTS = ['AKRON', 'DETROIT', 'GARY', 'TOLEDO', 'FLINT', 'BUFFALO', 'YOUNGSTOWN', 'PITTSBURGH', 'HAMILTON', 'WINDSOR', 'MONTREAL', 'TORONTO', 'WINNIPEG', 'EDMONTON',
  'HOUSTON', 'RICHMOND', 'OKLAHOMA CITY', 'CHICAGO', 'MILWAUKEE', 'DAYTON', 'LORAIN', 'ROCKFORD', 'FORT WAYNE', 'CALGARY', 'SEATTLE', 'ATLANTA', 'CHARLOTTE', 'DENVER'];
function works(V, beat) {
  if (beat < 56.8) return;
  WORKNET.forEach(([a, b], i) => {
    const u = ease.inOutCubic(sm(beat, 56.9 + 0.05 * i, 58.4 + 0.05 * i)); if (u <= 0) return;
    const pts = V.arc(TOWNS[a], TOWNS[b], { u1: u, n: 30, h: 0.01 });
    D.strokeArc(pts, { w: 6, col: k(1), casing: true }); ties(pts, 20, 9, 3);
  });
  GRID.forEach(([a, b], i) => {                                 // power on pylons
    const u = ease.inOutCubic(sm(beat, 57.6 + 0.35 * i, 59.6 + 0.35 * i)); if (u <= 0) return;
    const pts = V.arc(TOWNS[a], TOWNS[b], { u1: u, n: 40, h: 0.055 });
    D.strokeArc(pts, { w: 3, col: k(1), casing: true });
    for (let j = 2; j < pts.length - 1; j += 3) { const p = pts[j], q = V.pt(geoInterpolate(TOWNS[a], TOWNS[b])(pts[j][3]), 1); if (p[2] && q[2]) { g.strokeStyle = PAPER; g.lineWidth = 10; g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(p[0], p[1]); g.stroke(); g.strokeStyle = k(1); g.lineWidth = 4; g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(p[0], p[1]); g.stroke(); } }
  });
  if (beat < 62.6) NEWPLANTS.forEach((n, i) => {                // the plants rise lit, town by town, then make way for the lights
    const on = 57.2 + 0.15 * i, pop = ease.outBack(clamp((beat - on) / 0.35)), out = 1 - ease.inOutCubic(sm(beat, 61.4, 62.5));
    if (pop <= 0 || out <= 0) return;
    const p = V.pt(TOWNS[n]); if (!vis(p)) return;
    D.plantIcon(p[0], p[1] - 4, 26 * pop * out, { lit: true, casing: true });
  });
  PAIRS.forEach(pr => { const p = V.pt(TOWNS[pr.town]); if (vis(p)) { g.fillStyle = PAPER; g.beginPath(); g.arc(p[0], p[1], 17, 0, TAU); g.fill(); g.fillStyle = r(1); g.beginPath(); g.arc(p[0], p[1], 10, 0, TAU); g.fill(); } });
}
let MARK = null;
function markTargets(WD) {
  const im = K.BRAND.acp_mark, S = 440, c = document.createElement('canvas'); c.width = S; c.height = Math.round(S * im.height / im.width);
  const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0, c.width, c.height);
  const dat = cx.getImageData(0, 0, c.width, c.height).data, pts = [], step = 4, sc = 1.7;
  for (let y = 0; y < c.height; y += step) for (let x = 0; x < c.width; x += step) if (dat[(y * c.width + x) * 4 + 3] > 120) pts.push([540 + (x - c.width / 2) * sc, 1190 + (y - c.height / 2) * sc]);
  WD.allCities = WD.allCities || WD.cities.concat(CAN_CITIES.map(c => [c[0], c[1], c[2], c[3], 'CA'])).sort((a, b) => b[2] - a[2]);   // v18: the lights of both countries
  MARK = { pts, n: Math.min(pts.length, WD.allCities.length), rad: step * sc * 0.62 };
}
function lights(V, WD, beat) {
  if (beat < 57.2 || beat >= 70) return;
  if (!MARK) markTargets(WD);
  const N = MARK.n, towns = WD.allCities.slice(0, N);
  // pair towns to mark points by screen order (a sweep, no crossings), stable under the camera
  const scr = []; towns.forEach((c, i) => { const p = V.pt([c[0], c[1]]); if (p[2]) scr.push({ i, p, pop: c[2] }); });
  const order = scr.slice().sort((a, b) => (Math.round(a.p[1] / 40) - Math.round(b.p[1] / 40)) || a.p[0] - b.p[0]);
  const tg = MARK.pts.slice().sort((a, b) => (Math.round(a[1] / 40) - Math.round(b[1] / 40)) || a[0] - b[0]);
  g.fillStyle = PAPER;
  order.forEach((o, rank) => {
    const tgt = tg[Math.floor(rank * tg.length / order.length)];
    const on = 57.2 + 4.0 * Math.pow(o.i / WD.allCities.length, 0.55);
    if (beat < on) return;
    const gu = ease.inOutCubic(sm(beat, 61.4 + 1.2 * hash(o.i), 65.2)), pop = ease.outBack(clamp((beat - on) / 0.3));
    const x = lerp(o.p[0], tgt[0], gu), y = lerp(o.p[1], tgt[1], gu), s = lerp(2.4 + 3.4 * Math.min(1, Math.sqrt(o.pop / 1.5e6)), MARK.rad, gu) * pop;
    g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill();
  });
}


// ---------------------------------------------------------------- v18: SUPER IMPERIALISM (Hudson), between the tally and the planned economy
// hb 0-6   the bases' dollars run to the central banks abroad (gold dots, base to the nearest bank; the banks fill)
// hb 6-12  the banks send them back as bonds to the foot of Manhattan (the New York Fed keeps them), gold arcs over the pole and the sea
// hb 12-20 the loop: out to the bases again from that one point, back through the banks; it speeds up, then hands over to the hub (old b30)
export const HUD_LEN = 20;
const HSITES = SITES.filter((s0, i) => i % 5 === 0);
const bankOf = ll => { let bi = 0, bd = 9; CBANKS.forEach((c, i) => { const dd = geoDistance(ll, [c[1], c[2]]); if (dd < bd) { bd = dd; bi = i; } }); return bi; };
HSITES.forEach(s0 => { s0.bank = bankOf(s0.ll); });
function goldDot(p, rr = 6.5) { if (!vis(p)) return; g.fillStyle = PAPER; g.beginPath(); g.arc(p[0], p[1], rr + 3.5, 0, TAU); g.fill(); g.fillStyle = d(1); g.beginPath(); g.arc(p[0], p[1], rr, 0, TAU); g.fill(); }
export function hudson(V, WD, hb) {
  const res = {};
  drawGround(V, WD, {}); drawUS(V, WD, { states: V.cam.R > 700 }); drawLakes(V, WD);
  plantsHome(V, 30); ships(V, 30); roundelsAt(V, 30); counter(V, 29.99);
  const fillA = ease.inOutCubic(sm(hb, 0.6, 6.2)), sendB = ease.inOutCubic(sm(hb, 6.4, 11.6)), loop = sm(hb, 12, 20);
  // A: base -> bank, dots in a stream (faster as the section goes on)
  if (hb < 20) HSITES.forEach((s0, i) => {
    const c = CBANKS[s0.bank], B = [c[1], c[2]], h = 0.02 + 0.05 * geoDistance(s0.ll, B), rate = 0.55 + 0.9 * loop;
    if (hb < 0.4 + 0.012 * i) return;
    const u = ((hb * rate + hash(i)) % 1);
    goldDot(V.arcPoint(s0.ll, B, u, h), 5);
  });
  // the banks: gold vaults that fill, then send
  CBANKS.forEach((c, i) => {
    const p = V.pt([c[1], c[2]]); if (!vis(p)) return;
    const rr = 8 + 30 * fillA * (1 - 0.35 * sendB) + 6 * loop * (0.5 + 0.5 * Math.sin(hb * 6 + i));
    g.fillStyle = PAPER; g.beginPath(); g.arc(p[0], p[1], rr + 7, 0, TAU); g.fill();
    g.fillStyle = d(1); g.beginPath(); g.arc(p[0], p[1], rr, 0, TAU); g.fill();
    g.strokeStyle = k(1); g.lineWidth = 4; g.beginPath(); g.arc(p[0], p[1], rr, 0, TAU); g.stroke();
  });
  // B: bank -> the foot of Manhattan, gold arcs drawn out and carrying bonds (paper slips on gold)
  if (hb >= 6.2) CBANKS.forEach((c, i) => {
    const A = [c[1], c[2]], h = 0.04 + 0.09 * geoDistance(A, WS), u1 = ease.inOutCubic(sm(hb, 6.3 + 0.18 * i, 8.6 + 0.18 * i));
    const pts = V.arc(A, WS, { u0: 0, u1, n: 56, h }); if (pts.length > 1) goldLine(pts, 6);
    if (u1 >= 1) for (let j = 0; j < 3; j++) {
      const u = ((hb * (0.5 + 0.6 * loop) + j / 3 + hash(i + 40)) % 1), q = V.arcPoint(A, WS, u, h);
      if (vis(q)) { g.save(); g.translate(q[0], q[1]); g.rotate(0.4); g.fillStyle = PAPER; g.fillRect(-15, -10, 30, 20); g.strokeStyle = k(1); g.lineWidth = 3; g.strokeRect(-15, -10, 30, 20); g.fillStyle = d(1); g.fillRect(-9, -4, 18, 8); g.restore(); }
    }
  });
  // the one point: the hub swells with what comes back
  const wp = V.pt(WS);
  if (vis(wp)) {
    const rr = 10 + 26 * sendB + 8 * loop;
    g.fillStyle = PAPER; g.beginPath(); g.arc(wp[0], wp[1], rr + 8, 0, TAU); g.fill();
    g.fillStyle = d(1); g.beginPath(); g.arc(wp[0], wp[1], rr, 0, TAU); g.fill();
    g.strokeStyle = k(1); g.lineWidth = 5; g.beginPath(); g.arc(wp[0], wp[1], rr, 0, TAU); g.stroke();
  }
  // C: the loop closes: from that point out to the bases again (the war the loans pay for)
  if (hb >= 12) HSITES.forEach((s0, i) => {
    if (i % 2) return;
    const h = 0.03 + 0.07 * geoDistance(WS, s0.ll), u1 = ease.inOutCubic(sm(hb, 12.1 + 0.02 * i, 14.2 + 0.02 * i));
    const pts = V.arc(WS, s0.ll, { u0: 0, u1, n: 40, h }); if (pts.length > 1) D.strokeArc(pts, { w: 2.4, col: d(1), casing: true });
    if (u1 >= 1) goldDot(V.arcPoint(WS, s0.ll, ((hb * (0.7 + loop) + hash(i + 7)) % 1), h), 4.5);
  });
  return res;
}

// ---------------------------------------------------------------- the frame
export function draw(V, WD, beat, t) {
  const cam = V.cam, R = cam.R;
  if (!WSEG && WD.named['WALL ST']) {                       // the whole street, from the Broadway end to the river end
    const all = WD.named['WALL ST'].flat(), xs = all.map(p => p[0]); WSEG = [all[xs.indexOf(Math.min(...xs))], all[xs.indexOf(Math.max(...xs))]];
  }
  const res = {};
  if (beat >= 10.75 && beat < 10.84) res.flash = 0.85 - (beat - 10.75) / 0.09 * 0.5;
  const local = R > 5e4, akron = local && cam.lon < -78;
  if (akron) { akronScene(V, beat, WD); return res; }               // c20: the second dive
  drawGround(V, WD, {});
  if (!local && beat >= 12.4 && beat < 70) drawUS(V, WD, { states: R > 700 });
  if (!local) drawLakes(V, WD);
  if (R > 3e5) drawManhattan(V, WD);

  // ---- b0-9 the garrison, the rope, the guards
  if (beat < 9.5 && !local) roundelsAt(V, beat);
  if (beat >= 3.9 && beat < 8.4) rope(V, beat);
  // ---- b8-11 the order's line, Ramstein to Wall St, and Wall St
  if (beat >= 8 && beat < 11.2) {
    const u = ease.inOutCubic(sm(beat, 8.1, 10.5)), pts = V.arc(SITE.RAMSTEIN.ll, WS, { u0: 0, u1: u, h: 0.18 });
    if (!local && pts.length > 1) goldLine(pts, 7);
  }
  if (TAKE === 'b' && local) seizeB(V, beat, WD);
  if (R > 1.5e6) { if (beat < 30) wallMark(V, beat, { r: 16 }); wallStreet(V, beat); }
  if (local) return res;
  // ---- b12-17 the rents
  rents(V, beat);
  // ---- b16-24 the plants and the soldiers
  if (beat >= 12.4 && beat < 70) plantsHome(V, beat);
  if (beat >= 16.3 && beat < 50) ships(V, beat);
  // ---- the bases (helmets)
  if (beat >= 12 && beat < 48) roundelsAt(V, beat);
  // ---- b30-38 the planned economy, and its expropriation
  hub(V, beat);
  if (TAKE === 'a') seizeA(V, beat);
  network(V, beat, TAKE === 'a' ? 35.4 : 37.2, TAKE === 'a' ? 37.6 : 39.0);
  pairs(V, beat);
  counter(V, beat);
  works(V, beat);
  lights(V, WD, beat);
  return res;
}
