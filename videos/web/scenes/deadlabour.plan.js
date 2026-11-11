// DEAD LABOUR v3: the plan (pure: no DOM, no three.js, no renderer). The scene, tools/deadlabour_ledger.mjs (the score's ledger) and the
// node checks (labs/deadlabour/deposit_test.mjs) all read it. 60 BPM: t is seconds and beats.
//
// v2 (15 Oct 2026, the c20 round): THE DEPOSIT (research/october/DEADLABOUR_capital_designs.json, design 1, with both judges' grafts, and
// without the hours) replaces v1's slab. Capital is dead labour: a pale mass of the city's congealed night-shift light, made of nothing but
// what it took, the dead windows set inside it. It drinks through threads from the windows of the night downtown; the class gathers at its
// foot; the threads run the other way, the crown drains, and the windows come back on, building by building. Night. Marx's words in his order.
//
// The ground plan (metres): the deposit's axis at x 0, z DEP.ZC; its front faces +z, down the avenue (|x| < 32, z > 135). A cross street
// at z 200-240. The plaza round the deposit is open to ~120 m.

// v3 (15 Oct, the client on v2: "almost entirely a downgrade ... video concept from v1 is still correct, v2 overly reduces the visuals to
// moving around windows and slow methodical boring views of text"): v1's order and range of pictures, v1's ember sky and v1's dense threads,
// at speed; THE DEPOSIT in the monolith's place; the words short and quick, the picture carrying the idea. Shots: the avenue (frame 0) ->
// the crane -> under the crown (the threads converging) | the aerial over the city (the whole city feeding it) | down its flank, fast |
// the cross street | the plaza | the stop | the burst (the threads run out over the class) | the climb up its face | the top: down onto the
// class, then out over the city lit to the horizon, the threads unwinding into it.
// Cut on the score's grid: 100 BPM, a beat 0.6 s, a bar 2.4 s (the burst on bar 10, the top on bar 13, the mark on bar 17).
export const TL = { hook: 0, crane: 3.0, crown: 6.6, aerial: 9.6, flank: 13.8, street: 16.8, plaza: 19.2, still: 23.3, turn: 23.9, back: 24.1,
  burst: 24.0, rise: 28.8, top: 31.2, credit: 38.4, mark: 40.8, end: 43.8 };

// ------------------------------------------------------------------ THE DEPOSIT: its form, pure
// One stratum per quarter (cpgdp.json, 318 quarters Q1 1947 .. Q2 2026), 0.943 m each, oldest at the foot. Its half-width a = A (S / S_last)^GAMMA
// (S the share smoothed over SIG quarters), half-depth b = K a. GAMMA 0.3 (v2's first render used 0.5, area proportional to the share: the
// pinched 1986 waist under the swollen crown read as a vase and a goblet at phone size, the judges' risk 3); the order of the swellings is
// still the record's.
// Nothing of the data is on screen: it is only the body's girth, swollen most, and most recently, at the crown where it drinks now.
export const DEP = { H: 300, A: 55, K: 0.6, ZC: -14, NE: 3, SIG: 5, BAND: 3.77, APRON: [9, 14], CROWN: [246, 300], FRESH: 10, GAMMA: 0.3 };
export const DY = DEP.H / 318;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
const sst = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

// a small deterministic value noise (the same in node and the page; nothing here must match a shader)
function h3(x, y, z) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, k) => a + (b - a) * k;
  const c = (i, j, k) => h3(xi + i, yi + j, zi + k);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}
const fbm = (x, y, z, o = 3) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.07; a *= 0.5; } return s; };

let STR = null;
// the strata from the data: smoothed share and half-width per quarter
export function strata(J) {
  const S = J.rows.map(r => r[3]), n = S.length, sig = DEP.SIG, out = [];
  const Sm = S.map((_, i) => { let a = 0, w = 0; for (let k = -3 * sig; k <= 3 * sig; k++) { const j = Math.min(n - 1, Math.max(0, i + k)), g = Math.exp(-k * k / (2 * sig * sig)); a += S[j] * g; w += g; } return a / w; });
  const last = Sm[n - 1];
  for (let i = 0; i < n; i++) out.push({ q: J.rows[i][0], S: Sm[i], a: DEP.A * Math.pow(Sm[i] / last, DEP.GAMMA), y: (i + 0.5) * DY });
  STR = out; return out;
}
// half-width at height y, with the flowstone apron spreading at the foot (where everything that ran down has set)
export function halfW(y) {
  if (!STR) throw new Error('deadlabour: strata() first');
  const k = clamp(y / DY - 0.5, 0, STR.length - 1), i = Math.floor(k), f = k - i, a = lerp(STR[i].a, STR[Math.min(i + 1, STR.length - 1)].a, f);
  return a + DEP.APRON[0] * Math.exp(-Math.max(0, y) / DEP.APRON[1]) + 4 * Math.exp(-Math.max(0, y) / 40);
}
// the superellipse section (exponent NE), unit
function se(th) { const c = Math.cos(th), s = Math.sin(th), e = 2 / DEP.NE; return [Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e]; }
// the body's relief at (theta, y): hard lumps (zero-mean, ~7 %), vertical runnel flutes, a step at every year (4 strata, 3.77 m)
export function relief(th, y) {
  const c = Math.cos(th), s = Math.sin(th);
  const lump = 0.13 * fbm(c * 1.1 + 7, y / 44, s * 1.1 + 3) + 0.05 * fbm(c * 2.6 + 2, y / 15, s * 2.6 + 9) + 0.025 * vnoise(c * 6 + 1, y / 6, s * 6);
  const fl = th * 26 / Math.PI + 1.4 * vnoise(y / 40, 3, th);       // ~52 flutes round the body, wandering with height
  const flute = Math.pow(1 - Math.abs(2 * (fl - Math.floor(fl)) - 1), 3) * (0.5 + 0.7 * (0.5 + 0.5 * vnoise(fl * 0.7, y / 18, 9)));
  const yr = y / DEP.BAND, step = 0.3 * sst(0.82, 0.96, yr - Math.floor(yr));
  return { lump, cut: 0.9 * flute + step };
}
// the axis wanders: a grown thing, not a turned one (no lathe symmetry, no plumb line)
export function lean(y) { return [9 * vnoise(y / 120, 5.5, 1.3), 5 * vnoise(y / 95, 2.2, 7.7)]; }
// a point on the surface: theta measured in the xz plane from +x toward +z (theta = pi/2 faces down the avenue); y up
export function surface(th, y) {
  const a = halfW(Math.min(DEP.H, Math.max(0, y))), b = DEP.K * a, [ux, uz] = se(th), { lump, cut } = relief(th, y);
  const m = 1 + lump, r = Math.hypot(ux * a, uz * b) || 1, k = Math.max(0.2, m - cut / r);
  const [ox, oz] = lean(y);
  return [ox + ux * a * k, y, DEP.ZC + oz + uz * b * k];
}
export function normalAt(th, y) {
  const e = 0.004, p = surface(th, y), pa = surface(th + e, y), pb = surface(th, y + 0.6);
  const t1 = [pa[0] - p[0], pa[1] - p[1], pa[2] - p[2]], t2 = [pb[0] - p[0], pb[1] - p[1], pb[2] - p[2]];
  const n = [t2[1] * t1[2] - t2[2] * t1[1], t2[2] * t1[0] - t2[0] * t1[2], t2[0] * t1[1] - t2[1] * t1[0]], l = Math.hypot(...n) || 1;
  return n.map(v => v / l);
}
// the front surface z near x at height y (the cameras' clearances)
export function frontZ(y, x = 0) { let best = -1e9; for (let i = 0; i <= 180; i++) { const th = Math.PI * i / 180; const p = surface(th, y); if (Math.abs(p[0] - x) < 5) best = Math.max(best, p[2]); } return best > -1e8 ? best : DEP.ZC; }
// the drips: stone fringes under every swell (where the body widens upward faster than 0.25 m a metre), long on the back, short on the
// front quarters and kept off the frame-0 silhouette (the x extremes), so it never reads as candle, goblet or hourglass
export function drips(seed = 1867) {
  let s = seed | 0; const R = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const out = [];
  for (let y = 14; y < DEP.H - 6; y += 1.6) {
    const g = (halfW(y + 3) - halfW(y - 3)) / 6; if (g < 0.25) continue;
    const n = Math.round(30 + 60 * clamp(g)), ov = clamp((g - 0.25) / 0.9);
    for (let i = 0; i < n; i++) {
      const th = R() * Math.PI * 2, back = clamp(-Math.sin(th)), sil = Math.abs(Math.cos(th)) ** 6, front = clamp(Math.sin(th));
      const L = (2.5 + 9 * ov * (0.4 + 0.6 * R())) * (0.35 + 0.65 * back + 0.25 * (1 - front)) * (1 - 0.85 * sil);
      if (L < 1.2) continue;
      const p = surface(th, y), nr = normalAt(th, y);
      out.push({ p: [p[0] - nr[0] * 0.3, y + 0.4, p[2] - nr[2] * 0.3], L, r: 0.5 + 0.8 * R() * (0.5 + 0.5 * ov), th, y });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the words (verbatim; research/sources/texts/)
// [from, to, lines, y (first baseline), size, style]. Marx, Capital I ch.10 l.35 (the first three cards) and l.489 (the rest of his),
// in his order; the Party Program l.73, from AI-DRIVEN to LABORING YEARS (nothing elided inside it); Marx's own closing quotation.
export const CUES = [
  [-0.3, TL.crane, ['CAPITAL IS', 'DEAD LABOUR,'], 250, 112, 'main'],                                         // ch10:35
  [TL.crane, TL.crown, ['THAT, VAMPIRE-LIKE,', 'ONLY LIVES BY SUCKING', 'LIVING LABOUR,'], 230, 78, 'main'],
  [TL.crown, TL.aerial, ['AND LIVES THE MORE,', 'THE MORE LABOUR', 'IT SUCKS.'], 230, 78, 'main'],
  [10.2, 12.8, ['“SO LONG AS THERE IS', 'A MUSCLE, A NERVE,', 'A DROP OF BLOOD', 'TO BE EXPLOITED.”'], 230, 72, 'main'],   // ch10:489
  [17.0, 19.4, ['THE LABOURERS MUST', 'PUT THEIR HEADS TOGETHER,'], 230, 76, 'main'],
  [19.5, 23.3, ['AND, AS A CLASS,', 'COMPEL THE PASSING', 'OF A LAW,'], 230, 80, 'red'],
  [24.5, 26.9, ['AI-DRIVEN NATIONAL', 'ECONOMIC PLANNING'], 230, 80, 'main'],                                 // acp-program.txt:73
  [26.9, 29.0, ['REDUCING THE WORK WEEK', 'AND LABORING YEARS'], 230, 76, 'main'],
  [31.8, 36.2, ['“WHEN THE TIME', 'WHICH THE WORKER SELLS', 'IS ENDED, AND WHEN', 'HIS OWN BEGINS.”'], 230, 74, 'main'],   // ch10:489
];
export const SUBS = [[TL.credit, TL.mark, 'KARL MARX, CAPITAL, VOL. I (1867) · ACP PROGRAM', 1720, 32, 540]];
export const LINES = CUES.map(c => [Math.max(0, c[0]), c[2].join(' ')]);

// ------------------------------------------------------------------ the city: americana_city Skyline rows, the avenue and a cross street open
// [x0, x1, z0, z1, n, hMin, hMax, extra]. A tower's centre lies in its rectangle and its podium reaches up to 39 m from it, so the rows
// that line the avenue start at |x| 74, and the cross street (z 200-240) keeps centres outside z 161..279.
const R_ = (x0, x1, z0, z1, n, hMin, hMax, extra = {}) => ({ x0, x1, z0, z1, n, hMin, hMax, lit: 0.6, curtain: 0.4, ...extra });
export const SKY_SEED = 1866;
export const SKY_ROWS = [
  R_(74, 150, 135, 161, 3, 50, 170, { lit: 0.85, gain: 0.95 }), R_(-150, -74, 135, 161, 3, 50, 170, { lit: 0.85, gain: 0.95 }),
  R_(74, 150, 279, 420, 7, 40, 170, { lit: 0.85, gain: 0.95 }), R_(-150, -74, 279, 420, 7, 40, 170, { lit: 0.85, gain: 0.95 }),
  R_(74, 170, 480, 1600, 34, 40, 220, { lit: 0.78 }), R_(-170, -74, 480, 1600, 34, 40, 220, { lit: 0.78 }),
  R_(160, 760, -760, 160, 60, 30, 200, { lit: 0.7 }), R_(-760, -160, -760, 160, 60, 30, 200, { lit: 0.7 }),
  R_(200, 760, 280, 760, 26, 30, 200, { lit: 0.7 }), R_(-760, -200, 280, 760, 26, 30, 200, { lit: 0.7 }),
  R_(-150, 150, -760, -150, 18, 30, 180, { lit: 0.7 }),
  R_(160, 760, 760, 1600, 40, 30, 200), R_(-760, -160, 760, 1600, 40, 30, 200),
  R_(-3800, 3800, 1600, 3800, 200, 25, 170, { lit: 0.55, curtain: 0.3 }), R_(-3800, 3800, -3800, -760, 190, 25, 160, { lit: 0.55, curtain: 0.3 }),
  R_(760, 3800, -760, 1600, 110, 25, 170, { lit: 0.55, curtain: 0.3 }), R_(-3800, -760, -760, 1600, 110, 25, 170, { lit: 0.55, curtain: 0.3 }),
  R_(160, 3800, -3800, 3800, 520, 8, 28, { lit: 0.4, curtain: 0.1, gain: 0.7, roofs: false }), R_(-3800, -160, -3800, 3800, 520, 8, 28, { lit: 0.4, curtain: 0.1, gain: 0.7, roofs: false }),
  R_(-150, 150, -3800, -150, 60, 8, 28, { lit: 0.4, curtain: 0.1, gain: 0.7, roofs: false }), R_(-150, 150, 1600, 3800, 60, 8, 28, { lit: 0.4, curtain: 0.1, gain: 0.7, roofs: false }),
];

// every tier's building: its seed (iseed.x, shared by a building's tiers) and its top (the tallest tier's top): the windows go and come back
// building by building, top floors first inside each (the judges' graft: no ring front spreading outward)
export function buildingTops(tiers) { const top = new Map(); for (const t of tiers) { const k = t.seed[0], y = t.p[1] + t.s[1]; top.set(k, Math.max(top.get(k) || 0, y)); } return top; }
export const bhash = sx => { const v = sx * 0.7548776662 + 0.5698402910; return v - Math.floor(v); };
export const RANK_H = 0.22;                                            // the share of a ring's order spent inside a building (top floors first)
export function bRank(sx, y, top) { return (1 - RANK_H) * bhash(sx) + RANK_H * (1 - clamp(y / Math.max(8, top))); }

// ------------------------------------------------------------------ the sources: night-shift floors on the city's own towers
function mulberry(seed) { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const FLOOR = 3.9;
export const RINGS = [
  { group: 'r1', r0: 120, r1: 420, n: 760 }, { group: 'r2', r0: 420, r1: 700, n: 300 }, { group: 'r3', r0: 700, r1: 1100, n: 260 },
  { group: 'r4', r0: 1100, r1: 1700, n: 260 }, { group: 'O', r0: 1700, r1: 4000, n: 640 },
];
export function sampleSources(tiers, rings = RINGS, seed = 1867) {
  const r = mulberry(seed), out = [], tops = buildingTops(tiers);
  const T = tiers.filter(t => t.s[1] > 6).map(t => ({ t, A: 2 * (t.s[0] + t.s[2]) * t.s[1], d: Math.hypot(t.p[0], t.p[2] - DEP.ZC) }));
  for (const g of rings) {
    const cand = T.filter(c => c.d + 40 > g.r0 && c.d - 40 < g.r1), tot = cand.reduce((a, c) => a + c.A, 0);
    if (!cand.length) throw new Error(`deadlabour: no towers in ring ${g.group}`);
    let got = 0, tries = 0;
    while (got < g.n && tries++ < g.n * 400) {
      let q = r() * tot, c = cand[0]; for (const x of cand) { if ((q -= x.A) <= 0) { c = x; break; } }
      const { p, s } = c.t, side = Math.floor(r() * 4), along = r() - 0.5;
      const nf = Math.max(1, Math.floor(s[1] / FLOOR) - 1), fl = 1 + Math.floor(r() * nf), y = p[1] + fl * FLOOR + FLOOR * 0.55;
      if (y < 7) continue;
      const pt = side < 2 ? [p[0] + along * s[0], y, p[2] + (side ? 1 : -1) * (s[2] / 2 + 0.5)] : [p[0] + (side === 2 ? 1 : -1) * (s[0] / 2 + 0.5), y, p[2] + along * s[2]];
      const d = Math.hypot(pt[0], pt[2] - DEP.ZC); if (d < g.r0 || d >= g.r1) continue;
      if (Math.abs(pt[0]) < 34 && pt[2] > 0) continue;
      out.push({ p: pt, group: g.group, w: 1, key: bRank(c.t.seed[0], y, tops.get(c.t.seed[0])) }); got++;
    }
    if (got < g.n) throw new Error(`deadlabour: ring ${g.group} took ${got} of ${g.n} sources`);
  }
  out.push(...livingSources());                       // v6: the living in the plaza, group 'P'
  return out;
}

// ------------------------------------------------------------------ the ledger's flows (the deposit's own arrivals, no hours)
// The near city has been drinking since before frame 0; the far city joins at 3 s, faster and faster ("lives the more, the more labour it
// sucks"); it holds through the gathering and stops dead as the crowd closes in (29.6-30.1: the turn); from 30.6 every thread runs the
// other way, building by building, the near city first. Every source's key is its building rank (bRank), so the order the facades show is
// the order the threads carry.
export const FLOWS = [
  { name: 'the near city, since before dark', group: 'r1', sink: 'body', dir: 1, t0: -8, t1: 12, spread: 0.3, travel: 2.0 },
  ...['r2', 'r3', 'r4', 'O'].map((g, k) => ({ name: 'lives the more', group: g, sink: 'body', dir: 1, flux: [[1.0 + 0.7 * k, 0], [4.0 + 0.7 * k, 0.5], [9.8 + 0.5 * k, 1], [22.6, 1], [23.3, 0.25], [23.8, 0]], spread: 0.28, travel: 2.0 + 0.15 * k })),
  // the living: drawn on from before frame 0, harder as it goes, dead stop at the turn; the light goes back into them first
  { name: 'the living, drawn on', group: 'P', sink: 'body', dir: 1, flux: [[-2, 0.4], [3.0, 1], [22.6, 1], [23.3, 0.25], [23.8, 0]], spread: 0.3, travel: 1.8 },
  { name: 'the living, given back', group: 'P', sink: 'body', dir: -1, t0: 24.1, t1: 27.5, spread: 0.3, travel: 1.4 },
  { name: 'his own: near', group: 'r1', sink: 'body', dir: -1, t0: 24.1, t1: 30.0, spread: 0.35, travel: 1.6 },
  // the far city's light is still running home over it under Marx's last line (the threads unwinding into the lit city to the horizon)
  ...['r2', 'r3', 'r4', 'O'].map((g, k) => ({ name: 'his own', group: g, sink: 'body', dir: -1, t0: 24.5 + 0.8 * k, t1: 31.0 + 2.0 * k, spread: 0.35, travel: 1.9 + 0.15 * k })),
];
// the flows for a Siphon or a SiphonLedger: each source's key is its building rank, ranked over [0, 1]
export function flowsFor() { return FLOWS.map(f => ({ ...f, key: s => s.key, range: [0, 1], flux: f.flux ? f.flux.map(p => [...p]) : undefined })); }
// the packets: the beats the score's living figure plays while the deposit drinks (beads swell on them), none at the turn, then the
// figure's beats again as the light runs home
export function train() {
  const out = [];
  for (let t = -4; t < 9.8; t += 1) out.push(t);
  for (let t = 9.8; t < 23.3; t += 0.5) out.push(+t.toFixed(3));
  for (let t = 24.1; t < 37; t += 0.5) out.push(+t.toFixed(3));
  return out;
}

// ------------------------------------------------------------------ the crowd (pure layout and paths)
// ~430 people: where each will stand in the plaza (clumped, never a grid), where each comes from (a side, down the plaza, from behind the
// lens), when; and a few dozen seen walking in the cross street before the plaza fills.
export const CROWD_N = 680, STREET_N = 110;
// v6: THE LIVING. Some of the class are in the plaza from frame 0: 16 heroes close to the first camera (never on its path, x 1.5-8, z 84-100),
// and every ninth of the rest. Heads up, standing, each with a thread of light leaving them for the deposit's crown (livingSources); the
// threads stop at the turn and run back into them, and they raise their arms. Their positions are the sources' positions.
export const HERO_N = 16;
export function crowdPlan(seed = 1917) {
  const R = mulberry(seed), out = [];
  for (let i = 0; i < HERO_N; i++) { const side = i % 2 ? 1 : -1; let x, z, g = 0; do { x = side * (1.5 + 6.5 * R()); z = 84 + 16 * R(); } while (out.some(o => Math.hypot(o.x - x, o.z - z) < 1.3) && g++ < 99); out.push({ x, z, ph: R() * 10, lag: R() }); }
  const clumps = []; for (let i = 0; i < 110; i++) { const z = 34 + (1 - Math.pow(R(), 1.6)) * 96; clumps.push([(R() - 0.5) * (70 + 0.5 * (z - 34)), z]); }   // densest nearest the lens, the plaza filling toward the axis
  let guard = 0;
  while (out.length < CROWD_N && guard++ < 20000) {
    const c = clumps[Math.floor(R() * clumps.length)], k = 1 + Math.floor(R() * 7);
    for (let j = 0; j < k && out.length < CROWD_N; j++) {
      const x = c[0] + (R() - 0.5) * 6, z = c[1] + (R() - 0.5) * 6;
      if (Math.abs(x) > 70 || z < 30 || z > 128) continue;
      if (out.some(o => Math.hypot(o.x - x, o.z - z) < 0.78)) continue;
      out.push({ x, z, ph: R() * 10, lag: R() });
    }
  }
  // entries: from the sides (most), from further out in the plaza, from behind the lens; arrivals 18.6 .. 23.2, the front last
  out.forEach((p, i) => {
    const u = R(), side = p.x < 0 ? -1 : 1;
    let ex, ez;
    if (u < 0.55) { ex = p.x + side * (26 + 30 * R()); ez = p.z + (R() - 0.5) * 20; }
    else if (u < 0.8) { ex = p.x * 0.4 + (R() - 0.5) * 30; ez = p.z + 34 + 40 * R(); }
    else { ex = p.x + side * (12 + 16 * R()); ez = p.z + 26 + 24 * R(); }
    const speed = 1.15 + 0.5 * R(), arrive = 18.6 + 4.6 * Math.pow(R(), 0.8) * (0.55 + 0.45 * clamp((128 - p.z) / 90));
    let L = Math.hypot(ex - p.x, ez - p.z); const need = speed * (arrive - 15.6);
    if (L < need) { const k = need / L; ex = p.x + (ex - p.x) * k; ez = p.z + (ez - p.z) * k; L = need; }   // everyone already walking by 15.6
    Object.assign(p, { ex, ez, L, speed, t0: arrive - L / speed, arrive, heading: Math.atan2(p.x - ex, p.z - ez), raise: R() < 0.1 ? 23.6 + 3.5 * R() : null, i });
    if (i < HERO_N || i % 9 === 0) Object.assign(p, { living: true, t0: -1e3, arrive: -999, raise: R() < 0.6 ? 24.3 + 2.6 * R() : null });
  });
  return out;
}
// the living's thread-ends: a hand above each head, in the plaza; the siphon's group 'P', one thread each, keys 0..1
export function livingSources(seed = 1923) {
  const R = mulberry(seed);
  return crowdPlan().filter(p => p.living).map(p => ({ p: [p.x, 2.15, p.z], group: 'P', w: 1, key: R() }));
}
// where a plaza person is at t: walking in along a straight line, then standing; facing the deposit once arrived
export function crowdAt(p, t) {
  const u = clamp((t - p.t0) * p.speed / p.L), x = lerp(p.ex, p.x, u), z = lerp(p.ez, p.z, u), walking = u > 0 && u < 1;
  const face = Math.atan2(0 - x, DEP.ZC - z), settle = sst(p.arrive, p.arrive + 1.2, t);
  return { x, z, walking, u, d: u * p.L, heading: walking ? p.heading : lerpAng(p.heading, face, settle) };
}
const lerpAng = (a, b, u) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * u; };
// the walkers in the cross street (z 204-234): out of the street toward the avenue, turning down its left kerb toward the deposit, and
// joining the back of the crowd; seen from TL.street to the end
export function streetPlan(seed = 1919) {
  const R = mulberry(seed), out = [];
  for (let i = 0; i < STREET_N; i++) {
    const z = 204 + 30 * R(), xs = -150 + 40 * R(), turnX = -27 + 9 * R(), zEnd = 132 + 26 * R();
    out.push({ z, xs, turnX, zEnd, speed: 1.15 + 0.45 * R(), d0: 60 + Math.pow(R(), 0.6) * 90, ph: R() * 10 });     // most already round the corner
  }
  return out;
}
export function streetAt(w, t) {
  const run = w.turnX - w.xs, tot = run + (w.z - w.zEnd), d = Math.min(tot, w.d0 + Math.max(0, t - TL.street) * w.speed), walking = d < tot - 1e-6;
  if (d < run) return { x: w.xs + d, z: w.z, heading: Math.PI / 2, d, walking };
  const e = d - run, turn = clamp(e / 3); return { x: w.turnX, z: w.z - e, heading: lerpAng(Math.PI / 2, Math.PI, turn), d, walking };
}

// ------------------------------------------------------------------ the shots and the camera, pure in t (v1's order, at speed)
const L3 = (a, b, u) => a.map((v, i) => lerp(v, b[i], u));
const eio = u => { u = clamp(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const eout = u => 1 - Math.pow(1 - clamp(u), 3);
const D2R = Math.PI / 180;
export const AVE = { p: [0, 1.7, 430], pitch: 25, fov: 50 };
const up = [0, 1, 0];
function aveCam(t, t0, t1) {
  const push = 0.02 * (AVE.p[2] - DEP.ZC) * eio((t - t0) / (t1 - t0)), z = AVE.p[2] - push;
  return { p: [0, AVE.p[1], z], l: [0, AVE.p[1] + Math.tan(AVE.pitch * D2R) * (z - DEP.ZC), DEP.ZC], up, fov: AVE.fov, near: 0.5 };
}
const SHOTS = {
  avenue: (t) => ({ ...aveCam(t, 0, TL.crane) }),
  // v6: among the living, low, behind their heads, looking up past them at the mass: the threads leave their hands and go up into it
  crane: (t) => { const u = eio((t - TL.crane) / (TL.crown - TL.crane));
    return { p: [lerp(-0.4, 1.0, u), 1.55, lerp(114, 105, u)], l: [lerp(-1, 0, u), lerp(46, 74, u), DEP.ZC], up, fov: lerp(68, 64, u), near: 0.2 }; },
  // under the crown, looking up: every thread of the city converging into it from behind the lens and both sides (v1's face shot, the
  // threads fanning in). Far enough back that the crown is a mass against the sky, never a wall
  crown: (t) => { const u = (t - TL.crown) / (TL.aerial - TL.crown), e = eio(u);
    return { p: [lerp(-34, 22, e), lerp(150, 176, e), lerp(196, 168, e)], l: [lerp(-6, 4, e), lerp(262, 270, e), DEP.ZC], up, fov: 62, near: 1 }; },
  // the aerial: high over the city, behind and to one side; the deposit huge in the middle of frame and the whole city to the horizon
  // feeding it (v1's 11-16 s, without the chart: it never shrinks to a block, its top stays above the frame's middle)
  aerial: (t) => { const u = (t - TL.aerial) / (TL.flank - TL.aerial), a = (-28 + 14 * u) * D2R, d = lerp(520, 460, u);
    return { p: [Math.sin(a) * d, lerp(330, 300, u), DEP.ZC - Math.cos(a) * d], l: [0, lerp(165, 155, u), DEP.ZC], up, fov: 56, near: 2 }; },
  // down past its flank, fast, from well off to one side: its silhouette edge against the burning sky, the threads pouring past it, the
  // city below rushing up (v3 r1's close descent read as 3 s of blank wall)
  flank: (t) => { const u = (t - TL.flank) / (TL.street - TL.flank), e = eio(u), y = lerp(270, 24, e);
    return { p: [lerp(150, 120, e), y, lerp(150, 175, e)], l: [lerp(10, 0, e), y + lerp(-30, 30, e), DEP.ZC], up, fov: 60, near: 0.5 }; },
  // the cross street at eye height: the deposit at the street's end over the roofs, people walking out of the street toward it
  street: (t) => { const u = (t - TL.street) / (TL.plaza - TL.street);
    return { p: [lerp(-21, -17, u), 1.65, lerp(250, 240, u)], l: [lerp(-8, -4, u), lerp(44, 52, u), DEP.ZC], up, fov: 62, near: 0.2 }; },
  // the plaza: among the people, low, looking up at it; they arrive from both sides and from behind the lens; the threads stop over them
  plaza: (t) => { const u = (t - TL.plaza) / (TL.burst - TL.plaza), e = eio(u);
    return { p: [lerp(-8, -3, e), 1.6, lerp(146, 134, e)], l: [lerp(-2, 0, e), lerp(40, 60, e), DEP.ZC], up, fov: 64, near: 0.2 }; },
  // the burst: from behind the class, rising: every thread runs the other way, out of the crown over their heads to the city behind the lens
  burst: (t) => { const u = (t - TL.burst) / (TL.rise - TL.burst), e = eout(u);
    return { p: [lerp(0, 6, e), lerp(5, 46, e), lerp(150, 236, e)], l: [0, lerp(80, 150, e), DEP.ZC], up, fov: lerp(66, 60, e), near: 0.3 }; },
  // the climb: up its side at speed from 150 m off, its silhouette against the sky, the crown draining above
  rise: (t) => { const u = clamp((t - TL.rise) / (TL.top - TL.rise)), e = eio(u), y = lerp(60, 310, e);
    return { p: [lerp(-130, -90, e), y, lerp(160, 120, e)], l: [0, y + lerp(40, -20, e), DEP.ZC], up, fov: 60, near: 0.3 }; },
  // the top: just over the drained crown, behind its axis: first down over its lip toward the class far below, then tilting out
  // over the city lit to the horizon, the crown's lip in the foreground and the threads unwinding from it into the city (v1's ending)
  top: (t) => { const u = eout((t - TL.top) / (TL.credit - TL.top)), pt = lerp(-24, -12, u) * D2R, P = [lerp(-6, 0, u), lerp(334, 340, u), DEP.ZC - lerp(34, 26, u)];
    return { p: P, l: [P[0], P[1] + Math.sin(pt) * 100, P[2] + Math.cos(pt) * 100], up, fov: 58, near: 1 }; },
};
export const ORDER = [['avenue', 0], ['crane', TL.crane], ['crown', TL.crown], ['aerial', TL.aerial], ['flank', TL.flank], ['street', TL.street],
  ['plaza', TL.plaza], ['burst', TL.burst], ['rise', TL.rise], ['top', TL.top], ['mark', TL.mark]];
export function shotAt(t) { let s = 'avenue'; for (const [n, a] of ORDER) if (t >= a) s = n; return s; }
export function camAt(t) {
  const s = shotAt(t), name = s === 'mark' ? 'top' : s;
  return { ...SHOTS[name](Math.min(t, TL.mark - 1e-3)), shot: s };
}
// project a world point through a camAt() result to 1080 x 1920 pixels: [x, y, depth] (the node checks use it)
export function px(C, p, W = 1080, H = 1920) {
  const f = norm(sub(C.l, C.p)), rt = norm(cross(f, C.up || [0, 1, 0])), u = cross(rt, f), d = sub(p, C.p);
  const z = dot(d, f), tY = Math.tan(C.fov * D2R / 2), tX = tY * W / H;
  return [W / 2 + W / 2 * dot(d, rt) / z / tX, H / 2 - H / 2 * dot(d, u) / z / tY, z];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
