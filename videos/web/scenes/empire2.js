// CIVILIZATION: shut up about Europe; we're a continent, a civilization. Finance capital divides the
// world, and 750 bases in eighty countries pull guard duty for oligarchs. Every base comes home, every
// soldier a builder: bridges, rails, power. The working class builds. A civilization rising.
// (ACP program: close all overseas bases; the Public Works and Service Army; "national-continental American culture".)
// Base placement is illustrative: host-country counts are scaled to the commonly
// cited ≈750 total and scattered around each country's centroid.
import { feature } from '../node_modules/topojson-client/src/index.js';
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, rng, line,
  Finish, sigil, signoff, closer, outCanvas, seq, cue, BRAND, tinted } from '../lib/kit.js';

const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('empire2');
const logo = await loadImage('../assets/acp_logo_dark.png');
const finish = new Finish(1947);
const RED = C.red2, CREAM = C.cream, INK = '#0b0303', GOLD = '#ffcf7a';
const D2R = Math.PI / 180;

const CUES = [
  ...seq(0, [[1, 'SHUT THE'], [1, 'FUCK UP', 1], [2, 'ABOUT EUROPE.', 1], [2, "WE'RE A CONTINENT."], [2, 'A CIVILIZATION.', 1],
    [2, '750 BASES.', 1], [2, 'EIGHTY COUNTRIES.'], [1, 'FINANCE CAPITAL'], [1, 'DIVIDES'], [2, 'THE WORLD.', 1]]),
  ...seq(16, [[2, 'THE SOLDIERS?'], [2, 'SHIPPED OUT.', 1], [2, 'THE MILLS?'], [2, 'SHIPPED OUT.', 1], [2, 'GUARD DUTY', 1], [2, 'FOR OLIGARCHS.', 1]]),
  ...seq(32, [[2, 'BYE, EUROPE.', 1], [1, 'EVERY BASE'], [1, 'COMES HOME.', 1], [1, 'AVIANO'], [1, 'TO AKRON.', 1], [1, 'RAMSTEIN'], [1, 'TO RICHMOND.', 1],
    [1, 'BAHRAIN'], [1, 'TO BUFFALO.', 1], [1, 'OKINAWA'], [1, 'TO OKLAHOMA.', 1], [1, 'THE SOLDIERS?'], [1, 'HOME.', 1], [1, 'THE MILLS?'], [1, 'THREE SHIFTS.', 1]]),
  ...seq(48, [[1, 'EVERY SOLDIER'], [1, 'A BUILDER.', 1], [2, 'BRIDGES.'], [2, 'RAILS.'], [2, 'POWER.', 1], [2, 'THE WORKING CLASS'], [2, 'BUILDS', 1],
    [2, 'A CIVILIZATION'], [2, 'RISING.', 1]]),
];
const CUE = { y: 1240, size: 200, red: GOLD, shadow: 60 };        // inside the y=270-1250 safe band (§10.3)

// ---------------------------------------------------------------- land dots
const topo = await (await fetch('../node_modules/world-atlas/land-110m.json')).json();
const land = feature(topo, topo.objects.land);
const eq = document.createElement('canvas'); eq.width = 720; eq.height = 360;
const eg = eq.getContext('2d', { willReadFrequently: true });
eg.fillStyle = '#000'; eg.fillRect(0, 0, 720, 360); eg.fillStyle = '#fff';
for (const f of land.features) for (const poly of (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)) for (const ring of poly) {
  // a ring that crosses the antimeridian (Afro-Eurasia among them) is unwrapped and drawn at -360/0/+360, so Europe is on the globe;
  // a ring that never closes once unwrapped (Antarctica) is skipped as before
  let off = 0; const pts = ring.map(([lo, la], i) => { if (i) { const d = lo - ring[i - 1][0]; if (d > 180) off -= 360; else if (d < -180) off += 360; } return [lo + off, la]; });
  if (off !== 0) continue;
  for (const sh of [-360, 0, 360]) { eg.beginPath(); pts.forEach(([lo, la], i) => { const x = (lo + sh + 180) * 2, y = (90 - la) * 2; i ? eg.lineTo(x, y) : eg.moveTo(x, y); }); eg.fill(); }
}
const eqd = eg.getImageData(0, 0, 720, 360).data;
const isLand = (la, lo) => eqd[(Math.floor((90 - la) * 2) * 720 + Math.floor((lo + 180) * 2)) * 4] > 128;
const dots = [];
for (let la = -84; la <= 84; la += 1.5) {
  const step = 1.5 / Math.max(0.15, Math.cos(la * D2R));
  for (let lo = -180; lo < 180; lo += step) if (isLand(la, lo)) dots.push([la, lo]);
}

// ---------------------------------------------------------------- bases (illustrative) and home factories
const HOSTS = [['Japan', 36, 138, 120], ['Germany', 51, 10, 119], ['South Korea', 36.5, 127.8, 73], ['Italy', 42, 12.5, 44], ['UK', 53, -1.5, 25],
  ['Portugal/Azores', 38.5, -27, 21], ['Turkey', 39, 35, 13], ['Bahrain', 26, 50.5, 12], ['Belgium', 50.6, 4.5, 11], ['Saudi Arabia', 24, 45, 11],
  ['Kuwait', 29.3, 47.7, 10], ['Greece', 39, 22, 8], ['Philippines', 13, 122, 9], ['Australia', -25, 134, 7], ['Oman', 21, 57, 7], ['Netherlands', 52.2, 5.3, 7],
  ['Norway', 62, 10, 7], ['Colombia', 4, -73, 7], ['Iraq', 33, 44, 6], ['Syria', 35, 38.5, 6], ['Spain', 40, -4, 4], ['Poland', 52, 19, 4],
  ['Romania', 45.9, 25, 3], ['Bulgaria', 42.7, 25.5, 4], ['UAE', 24, 54, 3], ['Qatar', 25.3, 51.2, 3], ['Jordan', 31, 36, 2], ['Djibouti', 11.6, 43, 2],
  ['Niger', 17, 8, 2], ['Kenya', 0, 38, 1], ['Honduras', 14.8, -86.6, 2], ['Cuba', 20, -75.1, 1], ['Iceland', 64, -19, 1], ['Greenland', 76.5, -68.7, 1],
  ['Diego Garcia', -7.3, 72.4, 1], ['Singapore', 1.35, 103.8, 1], ['Guam', 13.4, 144.8, 6], ['Estonia', 58.6, 25, 1], ['Latvia', 57, 25, 1], ['Lithuania', 55, 24, 1],
  ['Kosovo', 42.6, 20.9, 1], ['Hungary', 47, 19.5, 2], ['Egypt', 27, 30, 1], ['Israel', 31, 35, 1], ['Peru', -10, -76, 2], ['Aruba', 12.5, -70, 1]];
const TOTAL = 750;
const raw = HOSTS.reduce((a, h) => a + h[3], 0);
const R = rng(1776);
const bases = [];
// closure groups follow the litany: the rest of Europe on BYE, EUROPE. (32), Aviano 36, Ramstein 38, the Gulf 40, the Pacific 42, the rest 44-47
const GULF = ['Bahrain', 'Saudi Arabia', 'Kuwait', 'Oman', 'UAE', 'Qatar', 'Iraq', 'Syria', 'Jordan', 'Egypt', 'Israel'];
const PACIFIC = ['Japan', 'South Korea', 'Guam', 'Philippines', 'Australia', 'Singapore'];
const FAR = ['Colombia', 'Honduras', 'Cuba', 'Aruba', 'Peru', 'Greenland', 'Niger', 'Kenya', 'Djibouti', 'Diego Garcia'];
const groupOf = h => h === 'Italy' ? 36 : h === 'Germany' ? 38 : GULF.includes(h) ? 40 : PACIFIC.includes(h) ? 42 : FAR.includes(h) ? 44 : 32;
const SPAN = { 32: 3.8, 36: 1.6, 38: 1.6, 40: 1.6, 42: 1.6, 44: 2.8 };
for (const [host, la, lo, n] of HOSTS) {
  const k = Math.max(1, Math.round(n * TOTAL / raw)), g = groupOf(host);
  // Europe is already crusted with bases under frame 0; the rest pop in west to east as the camera sweeps (8-14)
  for (let i = 0; i < k; i++) bases.push({ host, g, la: la + (R() - 0.5) * 3.2, lo: lo + (R() - 0.5) * 4.2,
    born: g <= 38 ? R() * 3 : 8 + clamp((lo + 110) / 260) * 5.5 + R() * 0.5, order: R() });
}
while (bases.length > TOTAL) bases.pop();
while (bases.length < TOTAL) { const b = bases[Math.floor(R() * bases.length)]; bases.push({ ...b, la: b.la + (R() - 0.5), lo: b.lo + (R() - 0.5), order: R() }); }
bases.sort((a, b) => a.order - b.order);
for (const g of [32, 36, 38, 40, 42, 44]) {                      // closure beat: each group on its litany frame; the count hits 0 at ~46.8
  const grp = bases.filter(b => b.g === g);
  grp.forEach((b, i) => { b.close = g + (i / grp.length) * SPAN[g]; });
}
const factories = [];
while (factories.length < 140) {
  const la = lerp(29, 47.5, R()), lo = lerp(-122, -72, R());
  if (isLand(la, lo)) factories.push({ la, lo });
}
bases.forEach((b, i) => { b.home = factories[i % factories.length]; });
factories.forEach((f, i) => { f.lit = Math.min(...bases.filter((b, j) => j % factories.length === i).map(b => b.close)) + 1.2; });
// the named homecomings: each flagship base flies home on its own word, and its town lights on TO ___.
const FLAGS = [[36, 'AVIANO', 46.03, 12.6, 'AKRON', 41.08, -81.52, 1], [38, 'RAMSTEIN', 49.44, 7.6, 'RICHMOND', 37.94, -122.35, 1],
  [40, 'NSA BAHRAIN', 26.21, 50.61, 'BUFFALO', 42.89, -78.88, 0], [42, 'KADENA', 26.35, 127.77, 'OKLAHOMA CITY', 35.47, -97.52, 0]];
for (const [g, pin, la, lo, town, tla, tlo, nato] of FLAGS) {
  const b = bases.find(x => x.g === g && x.close === g), home = { la: tla, lo: tlo, name: town, lit: g + 1 };
  factories.push(home);
  if (b) Object.assign(b, { la, lo, pin, nato, flag: true, home });
}

// ---------------------------------------------------------------- orthographic projection
let view = { lo: 0, la: 20, r: 430, cx: W / 2, cy: 800 };
function proj(la, lo) {
  const l0 = view.lo * D2R, p0 = view.la * D2R, a = la * D2R, dl = (lo * D2R) - l0;
  const cosc = Math.sin(p0) * Math.sin(a) + Math.cos(p0) * Math.cos(a) * Math.cos(dl);
  const x = Math.cos(a) * Math.sin(dl), y = Math.cos(p0) * Math.sin(a) - Math.sin(p0) * Math.cos(a) * Math.cos(dl);
  return [view.cx + x * view.r, view.cy - y * view.r, cosc];
}
function globe(kick) {
  ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(view.cx, view.cy, view.r * (1 + kick * 0.01), 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = CREAM;
  for (const [la, lo] of dots) {
    const [x, y, c] = proj(la, lo);
    if (c <= 0) continue;
    const s = (2.2 + 2.2 * c) * view.r / 430;
    ctx.globalAlpha = 0.35 + 0.65 * c; ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}
function slerp(a, b, u) {                                     // great-circle interpolation (lat/lon in degrees)
  const v = (la, lo) => [Math.cos(la * D2R) * Math.cos(lo * D2R), Math.cos(la * D2R) * Math.sin(lo * D2R), Math.sin(la * D2R)];
  const p = v(a.la, a.lo), q = v(b.la, b.lo);
  const d = Math.acos(clamp(p[0] * q[0] + p[1] * q[1] + p[2] * q[2], -1, 1)) || 1e-6;
  const s1 = Math.sin((1 - u) * d) / Math.sin(d), s2 = Math.sin(u * d) / Math.sin(d);
  const x = p[0] * s1 + q[0] * s2, y = p[1] * s1 + q[1] * s2, z = p[2] * s1 + q[2] * s2;
  return { la: Math.asin(clamp(z, -1, 1)) / D2R, lo: Math.atan2(y, x) / D2R };
}

// camera path (beats): every line sits on its place (the rhyme rule, §4.3)
const KEYS = [[0, 18, 46, 450], [3.5, 12, 46, 430],                       // SHUT THE / FUCK UP / ABOUT EUROPE.: over Europe, already crusted with bases
  [4, -97, 40, 520], [7.5, -97, 40, 540],                                   // WE'RE A CONTINENT. / A CIVILIZATION.: whip to North America
  [11, -25, 40, 430], [14, 60, 32, 400], [16, 55, 36, 430], [19.5, 48, 38, 470],   // 750 BASES. EIGHTY COUNTRIES.: the sweep east; THE WORLD. pulled back; THE SOLDIERS?
  [20, -92, 38, 700], [23.5, -92, 38, 730],                                 // THE MILLS? SHIPPED OUT.: the dark factories
  [24.5, 28, 42, 470], [31.5, 38, 40, 450],                                 // GUARD DUTY / FOR OLIGARCHS.: the gold, then the one silence
  [32, 12, 47, 470], [34, 4, 50, 450], [36, -35, 57, 430], [41.5, -48, 57, 430],   // BYE, EUROPE.; the North Atlantic litany: Aviano, Ramstein, Bahrain
  [42, -140, 58, 430], [43.5, -143, 58, 430],                               // OKINAWA / TO OKLAHOMA.: the arcs cross the north Pacific in view
  [45, -97, 40, 600], [48, -97, 38, 740], [50, -97, 38, 760],               // THE SOLDIERS? HOME. THE MILLS? THREE SHIFTS. EVERY SOLDIER / A BUILDER.
  [57.9, -97, 38, 760], [58, -97, 40, 520], [64, -97, 42, 580]];            // back from the montage: the lit continent becomes the gear
function camera(beat) {
  let k = 0; while (k < KEYS.length - 1 && beat >= KEYS[k + 1][0]) k++;
  const a = KEYS[k], b = KEYS[Math.min(k + 1, KEYS.length - 1)];
  const u = b[0] === a[0] ? 0 : ease.inOutCubic(clamp((beat - a[0]) / (b[0] - a[0])));
  let dlo = b[1] - a[1]; if (dlo > 180) dlo -= 360; if (dlo < -180) dlo += 360;
  view.lo = a[1] + dlo * u; view.la = lerp(a[2], b[2], u); view.r = lerp(a[3], b[3], u);
  view.cy = lerp(800, view.r > 600 ? 900 : 800, clamp((view.r - 430) / 300));
}

// FINANCE CAPITAL / DIVIDES / THE WORLD.: gold cuts carve the globe into territories (picture only)
const CUTS = [[70, -30], [10, 20], [-20, 95], [40, 150], [80, 60], [-60, -100], [25, -60]].map(([la, lo]) => {
  const p = [Math.cos(la * D2R) * Math.cos(lo * D2R), Math.cos(la * D2R) * Math.sin(lo * D2R), Math.sin(la * D2R)];
  const n = Math.hypot(p[1], p[0]) || 1, e1 = [p[1] / n, -p[0] / n, 0];
  return [e1, [p[1] * e1[2] - p[2] * e1[1], p[2] * e1[0] - p[0] * e1[2], p[0] * e1[1] - p[1] * e1[0]]];
});
function cutLines(beat) {
  ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5;
  CUTS.forEach(([e1, e2], i) => {
    const u = ease.outCubic(clamp((beat - 13 - i * 0.12) / 0.7)); if (u <= 0) return;
    ctx.globalAlpha = 0.8 * clamp(16.5 - beat); ctx.beginPath(); let on = false;
    for (let k = 0; k <= 120 * u; k++) {
      const th = k / 120 * Math.PI * 2 + i, v = e1.map((a, j) => a * Math.cos(th) + e2[j] * Math.sin(th));
      const [x, y, c] = proj(Math.asin(clamp(v[2], -1, 1)) / D2R, Math.atan2(v[1], v[0]) / D2R);
      if (c <= 0) { on = false; continue; }
      on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true;
    }
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}
// the NATO compass seal on the Aviano and Ramstein pins: it cracks on the snare as the base leaves (picture only, no words)
function seal(x, y, s, u) {
  ctx.save(); ctx.globalAlpha = 1 - clamp((u - 0.4) / 0.6); ctx.strokeStyle = CREAM; ctx.fillStyle = CREAM; ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(x + side * u * s * 0.6, y + u * u * s * 1.5); ctx.rotate(side * u * 0.35);
    ctx.beginPath(); ctx.rect(side < 0 ? -s - 3 : 0, -s - 3, s + 3, 2 * s + 6); ctx.clip();
    ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < 8; k++) { const r = k % 2 ? s * 0.22 : s * 0.8, a = k * Math.PI / 4 - Math.PI / 2; k ? ctx.lineTo(r * Math.cos(a), r * Math.sin(a)) : ctx.moveTo(r * Math.cos(a), r * Math.sin(a)); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  ctx.restore();
}
// A CIVILIZATION / RISING.: the continent's lights thicken into the ACP gear, which turns on RISING (the §6.9 motif)
function gear(beat) {
  const a = ease.outCubic(clamp((beat - 59) / 2.5)), M = tinted(BRAND.acp_mark, GOLD);
  const [x, y] = proj(39, -97), s = view.r * lerp(0.7, 0.95, a), h = s * M.height / M.width;
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.max(0, beat - 62) * 0.12);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85 * a; ctx.drawImage(M, -s / 2, -h / 2, s, h); ctx.restore();
}

// the Public Works Army: what comes home builds. Drawn in the globe's own halftone dots.
const DW = 108, DH = 192, dc = document.createElement('canvas'); dc.width = DW; dc.height = DH; const dg = dc.getContext('2d', { willReadFrequently: true });
function dotScene(kind, u, t, kick) {
  dg.fillStyle = '#000'; dg.fillRect(0, 0, DW, DH); dg.fillStyle = '#fff'; dg.strokeStyle = '#fff';
  const gy = 132;
  dg.globalAlpha = 0.35; dg.fillRect(0, gy, DW, DH - gy); dg.globalAlpha = 1;
  if (kind === 0) {                                              // bridge: the span closes left to right
    const x1 = lerp(10, 98, ease.outCubic(u)); dg.lineWidth = 2;
    dg.fillRect(8, gy - 30, 6, 30); dg.fillRect(94, gy - 30, 6, 30); dg.fillRect(8, gy - 34, x1 - 8, 4);
    dg.beginPath(); for (let x = 8; x < x1; x += 2) dg.lineTo(x, gy - 34 - Math.sin((x - 8) / 90 * Math.PI) * 30); dg.stroke();
    for (let x = 14; x < x1; x += 8) { dg.beginPath(); dg.moveTo(x, gy - 34); dg.lineTo(x, gy - 34 - Math.sin((x - 8) / 90 * Math.PI) * 30); dg.stroke(); }
  } else if (kind === 1) {                                       // rails laid toward the horizon; the high-speed trainset runs the new line toward us
    dg.lineWidth = 1.5; dg.beginPath(); dg.moveTo(20, DH); dg.lineTo(52, 70); dg.moveTo(88, DH); dg.lineTo(56, 70); dg.stroke();
    for (let k = 0; k < 16 * u; k++) { const z = k / 16, y = DH - (DH - 70) * (1 - Math.pow(1 - z, 2)), hw = lerp(40, 5, z); dg.fillRect(54 - hw, y, hw * 2, 2); }
    if (u > 0.35) {
      const tz = 1 - ease.outCubic(clamp((u - 0.35) / 0.6)), ty = DH - (DH - 72) * (1 - Math.pow(1 - tz, 2)), hw = lerp(36, 5, tz);
      dg.beginPath(); dg.moveTo(54 - hw, ty); dg.lineTo(54 + hw, ty); dg.lineTo(54 + hw * 0.7, ty - hw * 1.3);
      dg.quadraticCurveTo(54, ty - hw * 2, 54 - hw * 0.7, ty - hw * 1.3); dg.closePath(); dg.fill();
      dg.fillStyle = '#000'; dg.fillRect(54 - hw * 0.5, ty - hw * 1.35, hw, hw * 0.3); dg.fillStyle = '#fff';
    }
  } else if (kind === 2) {                                       // cranes and a skyline topping out
    for (let i = 0; i < 6; i++) { const h = (30 + (i * 37 % 50)) * clamp(u * 1.4 - i * 0.08); dg.fillRect(6 + i * 17, gy - h, 13, h); }
    dg.fillRect(70, 30, 3, gy - 30); dg.fillRect(40, 30, 60, 3); dg.fillRect(40 + 50 * (0.5 + 0.5 * Math.sin(t * 2)), 33, 1, 20 + 20 * u);
  } else if (kind === 3) {                                       // power: a station's towers, and pylons marching to the horizon as the line goes live
    for (const [x0, w0] of [[8, 22], [34, 18]]) {
      dg.beginPath(); dg.moveTo(x0, gy); dg.quadraticCurveTo(x0 + w0 * 0.3, gy - 40, x0 + 1, gy - 62); dg.lineTo(x0 + w0 - 1, gy - 62);
      dg.quadraticCurveTo(x0 + w0 * 0.7, gy - 40, x0 + w0, gy); dg.fill();
      for (let j = 0; j < 5; j++) { const p = (j / 5 + t * 0.6) % 1; dg.globalAlpha = 0.6 * (1 - p); dg.beginPath(); dg.arc(x0 + w0 / 2 + Math.sin(j * 2.1) * 3, gy - 66 - p * 50, 4 + p * 8, 0, 7); dg.fill(); }
      dg.globalAlpha = 1;
    }
    dg.lineWidth = 1;
    const n = Math.ceil(5 * clamp(u * 1.6)), py = k => { const z = k / 5; return [lerp(66, 104, z), lerp(56, 20, z), gy - lerp(0, 20, z)]; };
    for (let k = 0; k < n; k++) { const [x, h, y0] = py(k);
      dg.beginPath(); dg.moveTo(x - h * 0.18, y0); dg.lineTo(x, y0 - h); dg.lineTo(x + h * 0.18, y0); dg.moveTo(x - h * 0.3, y0 - h * 0.8); dg.lineTo(x + h * 0.3, y0 - h * 0.8); dg.stroke(); }
    dg.beginPath(); for (let k = 0; k < n; k++) { const [x, h, y0] = py(k); k ? dg.lineTo(x - h * 0.3, y0 - h * 0.8) : dg.moveTo(x - h * 0.3, y0 - h * 0.8); } dg.stroke();
  } else {                                                       // Richmond: a Liberty hull slides down the ways (its stencil is drawn after the dots)
    dg.beginPath(); dg.moveTo(0, gy - 6); dg.lineTo(108, gy - 34); dg.lineTo(108, gy - 30); dg.lineTo(0, gy - 2); dg.fill();
    const s = ease.inCubic(clamp(u * 1.2)) * 40, hx = 20 - s, hy = gy - 30 + s * 0.26;
    dg.beginPath(); dg.moveTo(hx, hy); dg.lineTo(hx + 78, hy - 20); dg.lineTo(hx + 84, hy - 44); dg.lineTo(hx + 4, hy - 30); dg.closePath(); dg.fill();
    dg.fillRect(hx + 30, hy - 48, 16, 12); dg.fillRect(hx + 36, hy - 60, 3, 12);
    dg.fillRect(92, 20, 3, gy - 50); dg.fillRect(60, 20, 45, 3); dg.fillRect(62 + 30 * (0.5 + 0.5 * Math.sin(t * 2)), 23, 1, 26);
  }
  const d = dg.getImageData(0, 0, DW, DH).data, step = W / DW;
  ctx.fillStyle = '#070203'; ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) { const v = d[(y * DW + x) * 4] / 255; if (v < 0.05) continue;
    ctx.fillStyle = y >= gy ? RED : GOLD; ctx.beginPath(); ctx.arc(x * step + step / 2, y * step + step / 2, step * (0.2 + 0.16 * Math.sin(x * 0.9 + y * 0.7 + t * 6) ** 2) * Math.sqrt(v) * (1 + 0.2 * kick), 0, 7); ctx.fill(); }
  if (kind === 4) {                                              // in-world texture, never a frame (§10.2.1): RICHMOND · 747 on the hull; the yard's day board, 244 days struck to 42
    const s = ease.inCubic(clamp(u * 1.2)) * 40, hx = 20 - s, hy = gy - 30 + s * 0.26;
    ctx.save(); ctx.translate((hx + 42) * step, (hy - 20) * step); ctx.rotate(-0.25);
    line(ctx, 'RICHMOND · 747', 0, 0, { family: 'Michroma', size: 44, color: CREAM, shadow: 20 }); ctx.restore();
    line(ctx, '244 DAYS', 90, 330, { family: 'Michroma', size: 40, align: 'left', color: CREAM, alpha: 0.8 });
    ctx.fillStyle = RED; ctx.fillRect(86, 314, 260, 6);
    line(ctx, '42 DAYS', 90, 392, { family: 'Michroma', size: 40, align: 'left', color: GOLD, alpha: clamp(u * 3) });
  }
}

window.renderFrame = async (t) => {
  const beat = B.beat(t), frame = Math.round(t * 30), kick = B.env('kick', t, 9);
  ctx.globalAlpha = 1;
  // nothing after the payoff: the ☭≡/acc + ACP.US lockup on the beat-64 gong, ≤1.4 s, then the loop seam (render --to 33.4)
  if (beat >= 64) { closer(ctx, (beat - 64) * B.spb); finish.apply(ctx, frame, { grain: 0.05, vignette: 0.6 }); return; }
  if (beat >= 50 && beat < 58) {
    const k = Math.floor((beat - 50) / 2); dotScene([0, 1, 3, 4][k], ((beat - 50) % 2) / 2, t, kick);   // BRIDGES. RAILS. POWER. THE WORKING CLASS (Richmond)
    cue(ctx, CUES, beat, B.spb, CUE);
    finish.apply(ctx, frame, { grain: 0.08, vignette: 0.85, flash: (beat - 50) % 2 < 0.15 ? 0.3 : 0 }); return;
  }
  camera(beat);
  ctx.fillStyle = '#070203'; ctx.fillRect(0, 0, W, H);
  // stars of the empire's night
  const sr = rng(3); ctx.fillStyle = 'rgba(244,230,208,0.5)';
  for (let i = 0; i < 140; i++) ctx.fillRect(sr() * W, sr() * H, 2, 2);
  globe(kick);
  if (beat >= 13 && beat < 16.5) cutLines(beat);
  // home factories: dark until their bases come home; the four named towns light on their own word
  for (const f of factories) {
    const [x, y, c] = proj(f.la, f.lo); if (c <= 0) continue;
    const on = beat >= f.lit;
    const s = (on ? 9 : 6) * view.r / 430 * (f.name ? 1.6 : 1);
    ctx.fillStyle = on ? GOLD : '#3a0a0a';
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
    if (on) { ctx.globalAlpha = 0.35 * clamp(1 - (beat - f.lit) / 2) + 0.12; ctx.beginPath(); ctx.arc(x, y, s * 2.4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    if (f.name && on && beat < f.lit + 2.5) line(ctx, f.name, x, y - 28 * view.r / 430, { family: 'Michroma', size: 26, color: GOLD, alpha: clamp((beat - f.lit) * 4) });
  }
  // bases: Europe's under frame 0, the rest in the sweep; gold while they guard the money; home on the litany
  const money = beat >= 24 && beat < 32;
  let open = 0;
  for (const b of bases) {
    if (beat < b.born) continue;
    if (beat >= b.close) {
      const u = (beat - b.close) / (b.flag ? 1 : 1.4);   // the arc home (a flagship lands on its TO ___.)
      if (u < 1) {
        ctx.strokeStyle = GOLD; ctx.lineWidth = b.flag ? 6 : 3; ctx.globalAlpha = 0.9 * (1 - u * 0.6); ctx.beginPath();
        let started = false;
        const tail = Math.max(0, u - 0.35);
        for (let s = 0; s <= 16; s++) {
          const p = slerp(b, b.home, lerp(tail, u, s / 16));
          const [x, y, c] = proj(p.la, p.lo);
          if (c <= 0) { started = false; continue; }
          const lift = Math.sin(Math.PI * lerp(tail, u, s / 16)) * 0.12 * view.r;
          const dx = x - view.cx, dy = y - view.cy, dn = Math.hypot(dx, dy) || 1;
          const X = x + dx / dn * lift, Y = y + dy / dn * lift;
          started ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); started = true;
        }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      continue;
    }
    open++;
    const [x, y, c] = proj(b.la, b.lo); if (c <= 0) continue;
    const pop = ease.outBack(clamp((beat - b.born) / 0.4));
    const s = 7 * pop * view.r / 430;
    ctx.fillStyle = money ? GOLD : '#ffffff';
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
  // the named pins: a tiny in-world name; Aviano and Ramstein carry the NATO seal, which cracks as the base leaves
  for (const b of bases) if (b.flag && beat >= b.g - 1.5 && beat < b.g + 1.2) {
    const [x, y, c] = proj(b.la, b.lo); if (c <= 0) continue;
    const u = clamp((beat - b.g) / 0.8);
    if (b.nato) seal(x, y - 40, 26, u);
    line(ctx, b.pin, x, y + 44, { family: 'Michroma', size: 24, color: CREAM, alpha: 1 - u });
  }
  // the count: races up with the pops (8-15), holds through the gold, falls to a gold 0 on THREE SHIFTS. (47)
  if (beat >= 8 && beat < 50) {
    const shown = beat < 32 ? bases.filter(b => beat >= b.born).length : open;
    line(ctx, `BASES ${shown}`, 70, 250, { family: 'Michroma', size: 64, align: 'left', color: shown === 0 ? GOLD : CREAM });
    ctx.fillStyle = RED; ctx.fillRect(72, 280, 420 * (shown / TOTAL), 10);
  }
  if (beat >= 59) gear(beat);
  let flash = 0;
  for (const cut of [4, 16, 20, 32, 42, 48, 58]) if (beat >= cut && beat < cut + 0.3) flash = 0.7 * (1 - (beat - cut) / 0.3);
  cue(ctx, CUES, beat, B.spb, CUE);
  finish.apply(ctx, frame, { grain: 0.08, vignette: 0.85, flash });
};
window.sceneReady = true;
