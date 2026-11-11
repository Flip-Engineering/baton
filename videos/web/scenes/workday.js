// THE WORKING DAY (4 Oct 2026, new piece). The eight-hour day as an American story Marx told, which is not finished.
// A time card: the hours stamped down it by the clock, 8, 10, 12, 14, 16, 18, faster and faster; Marx's sentence on the lengths
// of the working-day; the antinomy, and "Between equal rights force decides." pulled in letterpress; the United States passage
// of Capital I ch. 10 in full across four cards, the last over an engraved map of the States with the eight hours' agitation
// running as a red line from New England to California; the Baltimore Congress of 16 August 1866 struck by a dater; its
// resolution in full; Debs, 1911; the mark.
// Sources (verbatim): research/sources/texts/marx-capital1-ch10.txt (lines 29, 43, 479, 481), debs-8hrday.txt (line 13).
// Built on NOT A FOOTNOTE's print machinery (type_world setBlock, print.js letterpress, type_press daterStamp). 60 BPM: beats = seconds.
// v2 (7 Oct): v1 was type on paper and nothing else (the client's NOT A FOOTNOTE v1 note, 'visually ... very dull', applies). The script stays verbatim;
// under it now are the workers of 1904: Westinghouse Works (American Mutoscope & Biograph, Bitzer; public domain), baked by scripts/reelbake.py
// (assets/workday/reel.json) and played by lib/fx/reel.js. The time card's rows are windows on the time clock, women punching in, one row a day,
// the stamps landing over them; every page has its shop inked into the paper under the type (the machine aisle, the armature winders, the ring
// crew at the fire, the ladle); 'force decides.' over the fire at full strength. Score: songs2/workday_e.py (electronic).
import { feature, mesh } from 'topojson-client';
import { geoPath, geoAlbersUsa } from 'd3-geo';
import { W, H, clamp, lerp, ease, loadFonts, closer } from '../lib/kit.js';
import { loadFace, cpuOut, canvas2d } from '../lib/fx/type.js';
import { paperStock, finishPlate } from '../lib/fx/type_sets.js';
import { setBlock, measure } from '../lib/fx/type_world.js';
import { daterStamp } from '../lib/fx/type_press.js';
import { Print } from '../lib/fx/print.js';
import { Reel } from '../lib/fx/reel.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = cpuOut();
await loadFonts();
const F = Object.fromEntries(await Promise.all(['anton', 'ultra', 'playfair', 'fell', 'oswald', 'shoulders'].map(async k => [k, await loadFace(k)])));
const finish = finishPlate({ seed: 1866 });
const INK = '#15110f', RED = '#b3141f', GREY = '#5b5650';

// the timeline, seconds (the song is 60 BPM, so these are its beats too)
export const TL = { card: 0, lengths: 5.0, anti: 8.6, force: 12.4, us1: 15.4, us2: 19.6, us3: 23.0, rail: 25.6, stamp: 31.6, r1: 33.6, r2: 39.6, debs: 42.6, mark: 47.8, end: 51.0 };
const HOURS = [8, 10, 12, 14, 16, 18], HIT = [0.3, 1.4, 2.3, 3.0, 3.55, 4.0];   // the clock's strikes, closing up (the score's too)

// ---------------------------------------------------------------- stock and helpers (as NOT A FOOTNOTE)
const paper = paperStock({ w: W, h: H, seed: 8, base: [238, 233, 220], tooth: 8, fibres: 1800, burn: 0.08 });
const card = paperStock({ w: W, h: H, seed: 18, base: [228, 210, 168], tooth: 9, fibres: 2400, burn: 0.1 });    // manila card stock
const strip = s => s.replace(/\*/g, '');
const PR = new Print();
function plateOf(draw, steps) { const src = canvas2d(W, H); src.g.fillStyle = '#fff'; src.g.fillRect(0, 0, W, H); draw(src.g);
  const out = canvas2d(W, H); PR.render(out.g, src.cv, steps, { paper: 'newsprint' }); out.g.getImageData(0, 0, 1, 1); return out.cv; }
const fillBlk = (g, b, col = '#000') => { g.fillStyle = col; for (const q of b.glyphs) { g.save(); g.translate(q.ox, q.oy); g.fill(q.path); g.restore(); } };
const LP = { ink: 'carbon', thr: 0.5, squeeze: 0.5, deboss: 0.15, mottle: 0.6, kiss: 0.7 };
// a letterpress pull lifted off its sheet as ink only (alpha = how much darker than white), in a colour, so it sits on any stock
function inkOf(pull, rgb) { const c = canvas2d(W, H); c.g.drawImage(pull, 0, 0);
  const id = c.g.getImageData(0, 0, W, H), d = id.data; for (let i = 0; i < d.length; i += 4) { const a = clamp((235 - d[i + 1] - 28) / 130); d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255 * a * 0.95; }
  c.g.putImageData(id, 0, 0); return c.cv; }
function strike(g, img, age, cx = W / 2, cy = H / 2) {   // house strike: in from 116%, a two-frame squash, settle
  if (age < 0) return; const u = clamp(age / 0.11), sc = age < 0.11 ? lerp(1.16, 1, ease.outCubic(u)) : 1, sq = age >= 0.11 && age < 0.18 ? 0.965 : 1;
  g.save(); g.translate(cx, cy); g.scale(sc, sc * sq); g.drawImage(img, -cx, -cy, W, H); g.restore(); }
function wrap(font, text, cap, maxW) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (measure(font, strip(t), cap) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function setting(text, { font = F.playfair, cap = 60, x = 70, y = 600, maxW = 940, lh = 1.6, col = INK } = {}) {
  const lines = wrap(font, text, cap, maxW), words = []; let red = false;
  lines.forEach((ln, li) => { let cx = x;
    for (const raw of ln.split(' ')) {
      const starts = raw.startsWith('*'), ends = raw.replace(/[.,;:—"”’)-]+$/, '').endsWith('*'); if (starts) red = true;
      const w = strip(raw), blk = setBlock(font, [{ text: w, cap }], { role: 'micro', x: cx, y: y + li * cap * lh, align: 'left', maxW: 2000 });
      words.push({ w, blk, red, col }); if (ends) red = false;
      cx += measure(font, w, cap) + cap * 0.3; } });
  const right = Math.max(...words.map(w => w.blk.bbox.x2));
  if (right > x + maxW + 2 || y + lines.length * cap * lh > H - 60) throw new Error(`workday: setting overflows (${text.slice(0, 40)}...)`);   // fail loudly
  return { words, h: lines.length * cap * lh, n: lines.length };
}
function inkWord(g, wd, a, kiss) { g.save(); g.globalAlpha = a; g.fillStyle = wd.red ? RED : wd.col;
  for (const G of wd.blk.glyphs) { g.save(); g.translate(G.ox, G.oy - kiss * 6); g.fill(G.path); g.restore(); } g.restore(); }
function drawSetting(g, S, u, span) { const n = S.words.length;
  S.words.forEach((wd, i) => { const a = u - (i / Math.max(1, n - 1)) * span; if (a < 0) return; inkWord(g, wd, clamp(a / 0.05), Math.max(0, 1 - a / 0.07)); }); }
function micro(g, s, y, { x = 70, cap = 30, col = GREY, align = 'left', font = F.oswald, tracking = 0.1 } = {}) {
  const b = setBlock(font, [{ text: s, cap, tracking }], { role: 'micro', x, y, align, maxW: 2000 }); fillBlk(g, b, col); return b; }
function sheet(g) { g.drawImage(paper, 0, 0); }
function dateline(g, s) { micro(g, s, 230, { cap: 30, col: GREY }); g.fillStyle = RED; g.fillRect(70, 262, 120, 5); }
const CAPITAL = 'KARL MARX · CAPITAL, VOLUME I, CHAPTER 10 · 1867';

// ---------------------------------------------------------------- v2: the film of 1904, inked into the stock
const reel = await Reel.load('../assets/workday/plates');
const CUTS = Reel.cuts([
  [TL.lengths, 'aisle', { z: [1.04, 1.14] }], [TL.anti, 'armature', { z: [1.03, 1.1] }], [TL.force, 'ring', { z: [1.02, 1.1] }],
  [TL.us1, 'aisle2', { z: [1.04, 1.12] }], [TL.us2, 'ladle', { z: [1.03, 1.1] }], [TL.us3, 'ring2', { z: [1.04, 1.1] }], [TL.rail, 'aisle', { off: 1.0 }],
  [TL.stamp, 'punch3', { z: [1.04, 1.1] }], [TL.r1, 'armature2', { z: [1.03, 1.1] }], [36.6, 'guide', { z: [1.03, 1.08] }], [TL.r2, 'ring3', { z: [1.03, 1.1] }],
  [TL.debs, 'punch2', { z: [1.03, 1.1], rate: 0.8 }], [45.2, 'ladle2', { z: [1.03, 1.08] }],
], x => x, TL.mark + 3);
const FILM = canvas2d(W, H);
async function inkFilm(g, t, dens = 0.5, wash = 0.32) {    // the shop in ink on the sheet (multiply), a paper wash over it so the type reads
  const fg = FILM.g; fg.fillStyle = '#fff'; fg.fillRect(0, 0, W, H); fg.save(); fg.filter = 'grayscale(1) contrast(1.45) brightness(1.08)';
  const r = await reel.draw(fg, t, CUTS); fg.restore(); if (!r) return;
  g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = dens; g.drawImage(FILM.cv, 0, 0); g.restore();
  if (wash > 0) { g.save(); g.globalAlpha = wash; g.drawImage(paper, 0, 0); g.restore(); }
}

// ---------------------------------------------------------------- 1. the time card: the clock stamps the hours down it
const ROW0 = 560, ROWH = 214, DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const CARD = (() => { const c = canvas2d(W, H), g = c.g; g.drawImage(card, 0, 0);
  micro(g, 'TIME CARD', 150, { cap: 34, col: INK, tracking: 0.3 }); micro(g, 'NO. 1866', 150, { x: 1010, cap: 34, col: INK, align: 'right', tracking: 0.2 });
  const hd = setBlock(F.anton, [{ text: 'THE WORKING DAY.', cap: 128 }], { role: 'micro', x: 70, y: 300, align: 'left', maxW: 940 }); fillBlk(g, hd, INK);
  g.fillStyle = INK; g.fillRect(70, 410, 940, 6);
  micro(g, 'DAY', 470, { cap: 28 }); micro(g, 'HOURS', 470, { x: 260, cap: 28 });
  g.fillStyle = RED; for (let i = 0; i <= DAYS.length; i++) g.fillRect(70, ROW0 + i * ROWH - 34, 940, i === 0 ? 4 : 2);     // the card's red rules
  g.fillRect(220, ROW0 - 34, 2, DAYS.length * ROWH);
  DAYS.forEach((d, i) => micro(g, d, ROW0 + i * ROWH + 70, { cap: 44, col: GREY, tracking: 0.12 }));
  return c.cv; })();
// the clock's stamps: one letterpress pull of all six rows (ink lifted onto the card); 18 HOURS in red
const STAMPS = (() => { const blk = HOURS.map((h, i) => setBlock(F.shoulders, [{ text: `${h} HOURS`, cap: 150, tracking: 0.02 }],
  { role: 'micro', x: 262, y: ROW0 + i * ROWH + 54, align: 'left', maxW: 740 }));
  const black = inkOf(plateOf(g => blk.slice(0, 5).forEach((b, i) => { g.save(); g.translate(262, ROW0 + i * ROWH + 54); g.rotate((i % 2 ? 1 : -1) * 0.012); g.translate(-262, -(ROW0 + i * ROWH + 54)); fillBlk(g, b); g.restore(); }), [['letterpress', LP]]), [21, 17, 15]);
  const red = inkOf(plateOf(g => { g.save(); g.translate(262, ROW0 + 5 * ROWH + 54); g.rotate(-0.02); g.translate(-262, -(ROW0 + 5 * ROWH + 54)); fillBlk(g, blk[5]); g.restore(); }, [['letterpress', LP]]), [179, 20, 31]);
  return { black, red }; })();
async function drawCard(g, t) {
  // the whole card from frame 0 (its head is the hook); a kick on each strike
  let kick = 0; HIT.forEach(h => { const a = t - h; if (a >= 0 && a < 0.1) kick = a < 0.034 ? 9 : a < 0.067 ? -4 : 1; });
  g.fillStyle = '#0d0b09'; g.fillRect(0, 0, W, H);
  g.save(); g.translate(0, kick);
  g.drawImage(CARD, 0, 0);
  // v2: each day's row is a window on the time clock: women punching in, a different moment of the line each day, from its stamp on
  for (let i = 0; i < HOURS.length; i++) { const a = t - HIT[i] + 0.15; if (a < 0) continue;
    const y0 = ROW0 + i * ROWH - 30, fr = Math.floor((0.6 + a) * 24);
    FILM.g.fillStyle = '#fff'; FILM.g.fillRect(0, 0, W, H); FILM.g.save(); FILM.g.filter = 'grayscale(1) contrast(1.15) brightness(1.4)';
    await reel.drawShot(FILM.g, 'punch' + (i + 1), fr, { x: 230, y: y0 - 280, w: 780, h: 780 * 16 / 9 * 0.5, cy: 0.5, z: 1 }); FILM.g.restore();
    g.save(); g.beginPath(); g.rect(230, y0, 780, ROWH - 6); g.clip(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = clamp(a / 0.15) * 0.6; g.drawImage(FILM.cv, 0, 0); g.restore(); }
  HOURS.forEach((h, i) => { const a = t - HIT[i]; if (a < 0) return; const y0 = ROW0 + i * ROWH - 32, cy = ROW0 + i * ROWH - 20;
    g.save(); g.beginPath(); g.rect(230, y0, 780, ROWH - 4); g.clip(); strike(g, i === 5 ? STAMPS.red : STAMPS.black, a, 600, cy); g.restore(); });
  g.restore();
}

// ---------------------------------------------------------------- 2-4. the lengths, the antinomy, force decides
const LENGTHS = setting('So we find working-days of *8, 10, 12, 14, 16, 18 hours,* i.e., of the most different lengths.', { cap: 92, y: 560, lh: 1.42 });
const ANTI = setting('There is here, therefore, an antinomy, right against right, both equally bearing the seal of the law of exchanges.', { cap: 80, y: 520, lh: 1.5 });
const FORCE = (() => { const b1 = setBlock(F.playfair, [{ text: 'Between', cap: 150 }, { text: 'equal rights', cap: 150 }], { role: 'micro', x: 540, y: 700, maxW: 960, gap: 0.45 });
  const b2 = setBlock(F.ultra, [{ text: 'force', cap: 250 }, { text: 'decides.', cap: 250 }], { role: 'micro', x: 540, y: 1300, maxW: 960, gap: 0.3 });
  if (b1.shrunk || b2.shrunk) throw new Error('workday: FORCE shrunk');
  return { black: inkOf(plateOf(g => fillBlk(g, b1), [['letterpress', LP]]), [21, 17, 15]), red: inkOf(plateOf(g => fillBlk(g, b2), [['letterpress', LP]]), [179, 20, 31]) }; })();

// ---------------------------------------------------------------- 5-8. the United States passage, in full
const US1 = setting('In the United States of North America, every independent movement of the workers was paralysed so long as slavery disfigured a part of the Republic.', { cap: 74, y: 500, lh: 1.5 });
const US2 = setting('Labour cannot emancipate itself in the white skin where in the black it is *branded.*', { font: F.playfair, cap: 100, y: 560, lh: 1.42 });
const US3 = setting('But out of the death of slavery a new life at once arose.', { font: F.playfair, cap: 110, y: 640, lh: 1.4 });
const RAIL = setting('The first fruit of the Civil War was the *eight hours’ agitation,* that ran with the seven-leagued boots of the locomotive from the Atlantic to the Pacific, from New England to California.', { cap: 58, y: 380, lh: 1.5 });

// the map: the States (us-atlas, Albers, Alaska and Hawaii left off), engraved in ink on the sheet; the agitation's line runs
// over the rails from Boston to San Francisco (the 1869 line, town to town: a picture of Marx's figure, not a survey)
const ATL = await (await fetch('../node_modules/us-atlas/states-albers-10m.json')).json();
if (!ATL.objects || !ATL.objects.states) throw new Error('workday: us-atlas states missing');
const STATES = feature(ATL, ATL.objects.states).features.filter(f => f.id !== '02' && f.id !== '15');
const BORD = mesh(ATL, { type: 'GeometryCollection', geometries: ATL.objects.states.geometries.filter(g => g.id !== '02' && g.id !== '15') }, (a, b) => a !== b);
const PROJ = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const MAPX = 70, MAPY = 1250, MAPS = 0.96;          // map px = albers * MAPS + offset (the CONUS spans about 30..945 x 15..590)
const STOPS = [[-71.06, 42.36], [-71.8, 42.26], [-73.75, 42.65], [-76.15, 43.05], [-78.88, 42.89], [-81.69, 41.5], [-83.55, 41.65], [-87.63, 41.88],
  [-90.58, 41.52], [-95.94, 41.26], [-100.77, 41.12], [-104.82, 41.14], [-105.59, 41.31], [-107.24, 41.79], [-111.97, 41.22], [-115.76, 40.83],
  [-119.81, 39.53], [-121.49, 38.58], [-122.42, 37.77]].map(ll => { const p = PROJ(ll); if (!p) throw new Error('workday: stop off the projection ' + ll); return [MAPX + p[0] * MAPS, MAPY + p[1] * MAPS]; });
const SEG = STOPS.slice(1).map((p, i) => Math.hypot(p[0] - STOPS[i][0], p[1] - STOPS[i][1])), RLEN = SEG.reduce((a, b) => a + b, 0);
const MAP = (() => { const c = canvas2d(W, H), g = c.g; g.drawImage(paper, 0, 0);
  g.save(); g.translate(MAPX, MAPY); g.scale(MAPS, MAPS); const path = geoPath(null, g);
  g.lineJoin = 'round'; g.strokeStyle = INK; g.lineWidth = 7 / MAPS; for (const f of STATES) { g.beginPath(); path(f); g.stroke(); }   // the coast and borders, heavy
  g.fillStyle = '#e4dccb'; for (const f of STATES) { g.beginPath(); path(f); g.fill(); }                                      // the land (the heavy stroke's inner half is covered: the outline stays)
  g.strokeStyle = 'rgba(21,17,15,0.45)'; g.lineWidth = 1.6 / MAPS; g.beginPath(); path(BORD); g.stroke();                     // the state lines
  g.restore();
  micro(g, 'ATLANTIC', MAPY + 610, { x: 1010, cap: 28, col: GREY, align: 'right', tracking: 0.3 });
  micro(g, 'PACIFIC', MAPY + 610, { x: 70, cap: 28, col: GREY, tracking: 0.3 });
  return c.cv; })();
function railTo(g, k) {     // the line drawn to fraction k of its length; the locomotive at its head
  let left = k * RLEN; g.save(); g.strokeStyle = RED; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(...STOPS[0]);
  let head = STOPS[0];
  for (let i = 0; i < SEG.length && left > 0; i++) { const u = Math.min(1, left / SEG[i]); head = [lerp(STOPS[i][0], STOPS[i + 1][0], u), lerp(STOPS[i][1], STOPS[i + 1][1], u)]; g.lineTo(...head); left -= SEG[i]; }
  g.stroke();
  g.fillStyle = RED; g.beginPath(); g.arc(...STOPS[0], 13, 0, 7); g.fill();
  g.fillStyle = INK; g.beginPath(); g.arc(...head, 15, 0, 7); g.fill(); g.restore();
  return head; }
const NE = STOPS[0], CA = STOPS[STOPS.length - 1];

// ---------------------------------------------------------------- 9. Baltimore, 16 August 1866: the dater
const STAMP = daterStamp({ faces: { ring: F.oswald, word: F.shoulders }, word: 'EIGHT HOURS.', ring: ['GENERAL CONGRESS OF LABOUR', ''], rcap: 54,
  date: 'BALTIMORE · 16 AUG 1866', cx: 540, cy: 960, R0: 480, cap: 150, rot: -0.07 });
const BALT = 'GENERAL CONGRESS OF LABOUR · BALTIMORE · 1866';

// ---------------------------------------------------------------- 10-11. the resolution, in full; 12. Debs, 1911
const R1 = setting('“The first and great necessity of the present, to free the labour of this country from capitalistic slavery, is the passing of a law by which *eight hours* shall be the normal working-day in all States of the American Union.', { cap: 66, y: 440, lh: 1.5 });
const R2 = setting('We are resolved to put forth all our strength until this glorious result is attained.”', { font: F.playfair, cap: 100, y: 600, lh: 1.42 });
const DEBS = setting('And *eight hours is long enough,* and even too long, for a day in modern industry, and there is no earthly reason why the work day should be longer.', { cap: 78, y: 470, lh: 1.5 });

window.renderFrame = async (t) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  if (t < TL.lengths) await drawCard(ctx, t);
  else if (t < TL.anti) { sheet(ctx); await inkFilm(ctx, t); dateline(ctx, CAPITAL); drawSetting(ctx, LENGTHS, t - TL.lengths, 1.8); }
  else if (t < TL.force) { sheet(ctx); await inkFilm(ctx, t); dateline(ctx, CAPITAL); drawSetting(ctx, ANTI, t - TL.anti, 2.4); }
  else if (t < TL.us1) { sheet(ctx); await inkFilm(ctx, t, 0.95, 0.12); strike(ctx, FORCE.black, t - TL.force - 0.05); ctx.save(); ctx.globalCompositeOperation = 'multiply'; strike(ctx, FORCE.red, t - TL.force - 0.75); ctx.restore(); }
  else if (t < TL.us2) { sheet(ctx); await inkFilm(ctx, t); dateline(ctx, CAPITAL); drawSetting(ctx, US1, t - TL.us1, 3.0); }
  else if (t < TL.us3) { sheet(ctx); await inkFilm(ctx, t); dateline(ctx, CAPITAL); drawSetting(ctx, US2, t - TL.us2, 2.4); }
  else if (t < TL.rail) { sheet(ctx); await inkFilm(ctx, t, 0.6, 0.25); dateline(ctx, CAPITAL); drawSetting(ctx, US3, t - TL.us3, 1.4); }
  else if (t < TL.stamp) {
    const u = t - TL.rail; ctx.drawImage(MAP, 0, 0); dateline(ctx, CAPITAL); drawSetting(ctx, RAIL, u, 4.0);
    const k = ease.inOutCubic(clamp((u - 0.8) / 4.2)); railTo(ctx, k);
    micro(ctx, 'NEW ENGLAND', MAPY - 30, { x: 1010, cap: 34, col: INK, align: 'right', tracking: 0.12 });
    if (k > 0.98) micro(ctx, 'CALIFORNIA', CA[1] + 80, { x: CA[0] - 20, cap: 34, col: RED, tracking: 0.12 });
  }
  else if (t < TL.r1) { sheet(ctx); await inkFilm(ctx, t, 0.6, 0.25); STAMP.draw(ctx, t - TL.stamp - 0.05); }
  else if (t < TL.r2) { sheet(ctx); await inkFilm(ctx, t); dateline(ctx, BALT); drawSetting(ctx, R1, t - TL.r1, 4.2); }
  else if (t < TL.debs) { sheet(ctx); await inkFilm(ctx, t); dateline(ctx, BALT); drawSetting(ctx, R2, t - TL.r2, 1.8); }
  else if (t < TL.mark) { sheet(ctx); await inkFilm(ctx, t); dateline(ctx, 'EUGENE V. DEBS · THE EIGHT HOUR WORK DAY · 1911'); drawSetting(ctx, DEBS, t - TL.debs, 3.0); }
  else { const age = t - TL.mark; sheet(ctx); drawSetting(ctx, DEBS, 99, 1); ctx.fillStyle = `rgba(10,8,6,${clamp(age * 4, 0, 0.94)})`; ctx.fillRect(0, 0, W, H); closer(ctx, age); }
  finish.apply(ctx, Math.round(t * 30), { grain: 0.05, vignette: 0.3 });
  return {};
};
ready = true;
