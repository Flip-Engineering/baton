// ONE IS IN: PRESS (branch of ONE_IS_IN, 3 Oct). The client: "split the Debs concept with a branch that uses the
// typography/typecutting/printing pipelines for the text execution". Same concept, sources, order and timing as ONE_IS_IN b
// (assets/one_is_in/tl_b.json, the same score); the words are made, not captioned: a platen pull, the speech set line by line
// on a galley as a reporter took it down, the answer pulled by a riso drum, the sentence struck by a teller's stamp, the
// convict number punched into steel, the count pulled as a broadside, the dates set as a galley, then the mark.
import { W, H, clamp, lerp, ease, rng, loadFonts, closer } from '../lib/kit.js';
import { loadFace, cpuOut, canvas2d } from '../lib/fx/type.js';
import { paperStock, finishPlate } from '../lib/fx/type_sets.js';
import { setBlock, measure } from '../lib/fx/type_world.js';
import { risoPass, letterPunch, daterStamp, broadside } from '../lib/fx/type_press.js';
import { Print } from '../lib/fx/print.js';
// v3 (3 Oct): the client: use the print system (blockcut/woodcut, letterpress, riso) and the type engine's effects; fix text that doesn't appear or move as
// expected; stop the backwards text (the platen's mirrored forme was the Twins idea applied mechanically). So no forme is ever shown: the hook is a
// letterpress pull (black, then the red second impression off register), the photographs are woodcuts on newsprint, the count is the broadside sheet itself.

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = cpuOut();
await loadFonts();
const F = Object.fromEntries(await Promise.all(['anton', 'ultra', 'playfair', 'fell', 'oswald', 'shoulders'].map(async k => [k, await loadFace(k)])));
const finish = finishPlate({ seed: 1918 });
const TL = await (await fetch('../assets/one_is_in/tl_b.json')).json();
const loadImg = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
const IMG = { canton: await loadImg('../assets/one_is_in/canton_1918.jpg'), atlanta: await loadImg('../assets/one_is_in/atlanta_portrait.jpg'), release: await loadImg('../assets/one_is_in/release_1921.jpg') };
const INK = '#15110f', RED = '#b3141f', NEWS = [232, 226, 210];

// shot starts from the shared timeline
const SH = {}; { let t = 0; for (const s of TL.shots) { SH[s.id] = { t0: t, t1: t + s.dur, s }; t += s.dur; } }
const textsOf = id => (SH[id].s.texts || []).map(x => x.txt);
const strip = s => s.replace(/\*/g, '');

// ---------------------------------------------------------------- newsprint and a one-ink halftone of a photograph
const paper = paperStock({ w: W, h: H, seed: 16, base: NEWS, tooth: 10, fibres: 2600, burn: 0.12 });
function halftone(img, w, h, { cell = 9, fx = 0.5, fy = 0.45, zoom = 1 } = {}) {
  const c = canvas2d(w, h), g = c.g, cols = Math.ceil(w / cell), rows = Math.ceil(h / cell), s = canvas2d(cols, rows);
  const ar = img.width / img.height, tar = w / h; let sw = img.width / zoom, sh = img.height / zoom;
  if (ar > tar) sw = sh * tar; else sh = sw / tar;
  s.g.drawImage(img, clamp(img.width * fx - sw / 2, 0, img.width - sw), clamp(img.height * fy - sh / 2, 0, img.height - sh), sw, sh, 0, 0, cols, rows);
  const d = s.g.getImageData(0, 0, cols, rows).data; g.fillStyle = INK;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = (y * cols + x) * 4, L = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255, r = cell * 0.56 * Math.sqrt(clamp(1.08 - L * 1.1));
    if (r > 0.3) { g.beginPath(); g.arc(x * cell + cell / 2 + (y % 2) * cell / 2, y * cell + cell / 2, r, 0, 7); g.fill(); } }
  g.getImageData(0, 0, 1, 1); return c.cv;
}
const HT = { canton: halftone(IMG.canton, 960, 560, { fx: 0.6, fy: 0.42 }), atlanta: halftone(IMG.atlanta, 960, 700, { fy: 0.35 }), release: halftone(IMG.release, 960, 620) };   // (the riso drum's art)
// ---------------------------------------------------------------- v3: print.js plates, made once
const PR = new Print();
function plateOf(draw, steps, { paper: pp = 'newsprint' } = {}) {         // a full-frame source (black on white) through a press, onto paper -> a canvas
  const src = canvas2d(W, H); src.g.fillStyle = '#fff'; src.g.fillRect(0, 0, W, H); draw(src.g);
  const out = canvas2d(W, H); PR.render(out.g, src.cv, steps, { paper: pp }); out.g.getImageData(0, 0, 1, 1); return out.cv;
}
function photoTo(img, x, y, w, h, fx = 0.5, fy = 0.45) { return g => { const ar = img.width / img.height, tar = w / h; let sw = img.width, sh = img.height;
  if (ar > tar) sw = sh * tar; else sh = sw / tar; g.drawImage(img, clamp(img.width * fx - sw / 2, 0, img.width - sw), clamp(img.height * fy - sh / 2, 0, img.height - sh), sw, sh, x, y, w, h); }; }
const CUT = { pitch: 9, ink: 'carbon', contour: 1, t1: 0.28, t2: 0.7 };
const WOOD = { canton: plateOf(photoTo(IMG.canton, 60, 270, 960, 560, 0.6, 0.42), [['woodcut', CUT]]),
  atlanta: plateOf(photoTo(IMG.atlanta, 60, 260, 960, 640, 0.5, 0.35), [['woodcut', CUT]]),
  release: plateOf(photoTo(IMG.release, 60, 260, 960, 620), [['woodcut', CUT]]) };
// the hook: DO YOU KNOW in black, OF ANY? as the red second impression; red is lifted out of its own pull (ink = how much darker than the paper)
// v4: DO YOU KNOW read small at phone size on one line (cap 200, under the shout floor): two lines at the shout ceiling
const HOOK_B1 = setBlock(F.ultra, [{ text: 'DO YOU', cap: 320 }, { text: 'KNOW', cap: 320 }], { role: 'shout', x: 540, y: 690, maxW: 960, gap: 0.24 });
const HOOK_B2 = setBlock(F.anton, [{ text: 'OF ANY?', cap: 330 }], { role: 'shout', x: 540, y: 1200, maxW: 960 });
const fillBlk = (g, b, dx = 0, dy = 0) => { g.fillStyle = '#000'; for (const q of b.glyphs) { g.save(); g.translate(q.ox + dx, q.oy + dy); g.fill(q.path); g.restore(); } };
const LP = { ink: 'carbon', thr: 0.5, squeeze: 0.5, deboss: 0.15, mottle: 0.6, kiss: 0.7 };   // a light impression: ink in the paper, no bevel or rim (HANDBOOK II.6.7)
const HOOK_BLACK = plateOf(g => fillBlk(g, HOOK_B1), [['letterpress', LP]]);
const HOOK_RED = (() => { const pull = plateOf(g => fillBlk(g, HOOK_B2, 4, -3), [['letterpress', { ...LP, ink: 'carbon' }]]), c = canvas2d(W, H);
  c.g.drawImage(pull, 0, 0); const id = c.g.getImageData(0, 0, W, H), d = id.data, pp = paper.getContext('2d').getImageData(0, 0, W, H).data;
  for (let i = 0; i < d.length; i += 4) { const a = clamp((pp[i + 1] - d[i + 1] - 28) / 130); /* under 28 levels darker than the paper is paper tone, not ink (else a pink wash) */ d[i] = 179; d[i + 1] = 20; d[i + 2] = 31; d[i + 3] = 255 * a * 0.95; }
  c.g.putImageData(id, 0, 0); return c.cv; })();
// house strike (HANDBOOK II.6.7): in from 116%, a two-frame squash, settle
function strike(g, img, age, { x = 0, y = 0, w = W, h = H } = {}) {
  if (age < 0) return; const u = clamp(age / 0.11), sc = age < 0.11 ? lerp(1.16, 1, ease.outCubic(u)) : 1, sq = age >= 0.11 && age < 0.18 ? 0.965 : 1;
  g.save(); g.translate(x + w / 2, y + h / 2); g.scale(sc, sc * sq); g.drawImage(img, -w / 2, -h / 2, w, h); g.restore(); }

// ---------------------------------------------------------------- the galley: a sentence set word by word, each word kissed onto the sheet
function wrap(font, text, cap, maxW) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  const wOf = s => measure(font, s, cap);
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (wOf(strip(t)) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
// a setting: one sentence as positioned words. red words are marked *like this* in the timeline
function setting(text, { font = F.playfair, cap = 64, x = 70, y = 900, maxW = 940, lh = 1.75 } = {}) {
  const lines = wrap(font, text, cap, maxW), words = []; let red = false;
  lines.forEach((ln, li) => { let cx = x;
    for (const raw of ln.split(' ')) {
      const starts = raw.startsWith('*'), ends = raw.replace(/[.,;:—-]+$/, '').endsWith('*'); if (starts) red = true;
      const w = strip(raw), blk = setBlock(font, [{ text: w, cap }], { role: 'micro', x: cx, y: y + li * cap * lh, align: 'left', maxW: 2000 });
      words.push({ w, blk, red, li }); if (ends) red = false;
      cx += measure(font, w, cap) + cap * 0.32; } });
  return { words, h: lines.length * cap * lh };
}
function inkWord(g, wd, a, kiss) {
  g.save(); g.globalAlpha = a; g.fillStyle = wd.red ? RED : INK;
  for (const G of wd.blk.glyphs) { g.save(); g.translate(G.ox, G.oy); if (kiss > 0) { g.translate(0, -kiss * 6); } g.fill(G.path); g.restore(); }
  g.restore();
}
// draw a setting at local time u: words land across [0, span] s, each with a short kiss (lift, then pressed)
function drawSetting(g, S, u, span) {
  const n = S.words.length;
  S.words.forEach((wd, i) => { const tw = (i / Math.max(1, n - 1)) * span, a = u - tw; if (a < 0) return;
    inkWord(g, wd, clamp(a / 0.05), Math.max(0, 1 - a / 0.07)); });
}

// ---------------------------------------------------------------- the shots
const G = {};
// hook: the platen pulls the question
G.hook = { draw(g, t) { sheet(g); strike(g, HOOK_BLACK, t - 0.12); if (t >= 0.12) { g.save(); g.globalCompositeOperation = 'multiply'; strike(g, HOOK_RED, t - 0.62); g.restore(); } } };   // v3: a letterpress pull, no forme
// the Canton paragraph: p1..p6 on one galley, the photograph on top, the sheet scrolling as lines are added
const cantonText = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map(id => ({ id, txt: textsOf(id).join(' ').replace('the political of the master class.', 'the political twins of the master class.') }));
let gy = 900; const CANTON = cantonText.map(c => { const S = setting(c.txt, { y: gy }); const r = { ...c, S, y0: gy }; gy += S.h + 40; return r; });
// ask: the question set big; the answer pulled red by a riso drum on the answer mark
const ASK = setting(textsOf('ask')[0], { font: F.playfair, cap: 120, y: 760, x: 80, maxW: 920, lh: 1.3 });
const ANS = risoPass({ faces: { cond: F.anton }, text: ['I CERTAINLY', 'DO NOT.'], hit: TL.marks.answer - SH.ask.t0, clear: 99,
  artBlack: g => g.drawImage(HT.canton, 60, 1060, 960, 560) });   // drum 2 prints Debs at Canton, black over the red
// door and free: more of the same speech
const DOOR = setting(textsOf('door').join(' '), { cap: 60, y: 330, maxW: 960 });
// the door, as a printer's chase: 'one is in' locked inside the iron frame with quoins; 'the other trying to break in,' set
// outside and jammed against the frame's edge; then the line that closes it (Canton, verbatim, as ONE_IS_IN's door)
const DX = SH.door.s.extra, CH = { x: 130, y: 470, w: 820, h: 400 };
const IN = setting('one is in', { cap: 120, y: CH.y + CH.h / 2 + 40, x: 540 - (['one', 'is', 'in'].reduce((a, w) => a + measure(F.playfair, w, 120), 0) + 2 * 0.32 * 120) / 2, maxW: 2000 });
const OUT = setting('the other trying to *break in,*', { cap: 74, y: CH.y + CH.h + 120, x: 80, maxW: 940 });
const ONLY = setting('and that is substantially the only difference between them.', { cap: 62, y: 1290, x: 80, maxW: 920 });
function chase(g, a) { g.save(); g.globalAlpha = a; g.fillStyle = '#232120'; g.fillRect(CH.x - 26, CH.y - 26, CH.w + 52, 26); g.fillRect(CH.x - 26, CH.y + CH.h, CH.w + 52, 26);
  g.fillRect(CH.x - 26, CH.y, 26, CH.h); g.fillRect(CH.x + CH.w, CH.y, 26, CH.h);
  g.fillStyle = '#6b5a44'; for (const [qx, qy] of [[CH.x + 40, CH.y + 6], [CH.x + CH.w - 120, CH.y + CH.h - 34]]) g.fillRect(qx, qy, 80, 28);     // quoins
  g.restore(); }
const FREE = setting(textsOf('free').slice(1).join(' '), { cap: 70, y: 1020 });
// arrest: struck by a dater
const ARREST = daterStamp({ faces: { ring: F.oswald, word: F.shoulders }, word: 'TEN YEARS.', ring: ['SENTENCED TO', ''], rcap: 70, date: 'ARRESTED 30 JUNE 1918', cx: 540, cy: 900, R0: 470, cap: 190, rot: -0.08 });
// court: the statement on a fresh galley over the Atlanta portrait
const COURT = setting(textsOf('court').slice(1).join(' ').replace(/ \/ /g, ' '), { cap: 58, y: 980, lh: 1.7 });   // tl_b's " / " is a caption line mark, not a word
// pins: the convict number punched into steel
const PUNCH = letterPunch({ font: F.shoulders, text: '9653', cap: 430, strikes: [0.9, 1.2, 1.5, 1.8].map(x => SH.pins.t0 + x), y: 980, paintAfter: SH.pins.t0 + 2.1 });
// board: the count, pulled as a broadside's red second pass
const rows = SH.board.s.extra.rows;
const SHEET = broadside({ faces: { wood: F.ultra, cond: F.anton, body: F.playfair }, head: 'POPULAR VOTE, NOVEMBER 1920.', l1: '913,693', l2: 'FOR CONVICT NO. 9653.',
  body: [], imprint: 'EUGENE V. DEBS RAN FROM THE ATLANTA FEDERAL PENITENTIARY.', w: 1000, h: 1560, typeX: 500, typeW: 900 });
// v5 (8 Oct, archive audit item 1): the count set as a three-row table (NAME, VOTES, %). The run-on body it replaces printed the
// timeline's " / " line marks literally; here " / " is the line break inside a name cell. The Debs row is the red second pass.
function countTable(S) {
  const clean = paperStock({ w: S.w, h: S.h, seed: 4, base: [236, 226, 202], tooth: 12, fibres: 2200, burn: 0.16 });   // broadside()'s own paper
  const put = (g, font, text, cap, x, base, align, col, tracking = 0) => {
    const b = setBlock(font, [{ text, cap, tracking }], { role: 'micro', x, y: base - cap / 2, align, maxW: align === 'left' ? 440 : 300 });
    g.fillStyle = col; for (const q of b.glyphs) { g.save(); g.translate(q.ox, q.oy); g.fill(q.path); g.restore(); } };
  for (const [cv, redPass] of [[S.first, false], [S.sheet, true]]) {
    const g = cv.getContext('2d');
    g.drawImage(clean, 40, 880, S.w - 80, 170, 40, 880, S.w - 80, 170);              // lift the empty body's column rules off the sheet
    // v5b: the table sits under FOR CONVICT NO. 9653. (its baseline is sheet y 735): hung at y 180, the Debs row ends by frame y 1210 and
    // the % column at frame x 940, inside the safe band (SAFE y2 1250, x2 960). Name and party on one line; figures right-aligned.
    put(g, F.oswald, 'NAME', 22, 60, 790, 'left', INK, 0.12); put(g, F.oswald, 'VOTES', 22, 760, 790, 'right', INK, 0.12); put(g, F.oswald, '%', 22, 900, 790, 'right', INK, 0.12);
    g.fillStyle = INK; g.fillRect(60, 800, 840, 3); g.fillRect(60, 808, 840, 1.5);
    rows.forEach((r, i) => {
      if (r.debs && !redPass) return;
      const top = 818 + i * 80, col = r.debs ? RED : INK, [l1, l2 = ''] = r.name.split(' / ').map(s => s.replace(/,$/, ''));
      put(g, F.oswald, l1, 28, 60, top + 44, 'left', col); if (l2) put(g, F.oswald, l2, 18, 72 + measure(F.oswald, l1, 28), top + 44, 'left', col, 0.08);
      put(g, F.anton, r.n.toLocaleString('en-US'), 42, 760, top + 50, 'right', col); put(g, F.anton, r.pct, 42, 900, top + 50, 'right', col);
      if (!r.debs) { g.fillStyle = INK; g.fillRect(60, top + 66, 840, 1); }
    });
    g.getImageData(0, 0, 1, 1);
  }
}
countTable(SHEET);
const BOARD = { draw(g, u) {                                   // v3: the sheet itself on the bench (black pass, then the red second pass lands), no forme
  g.fillStyle = '#1c1916'; g.fillRect(0, 0, W, H);
  const k = ease.outCubic(clamp(u / 0.35)), y = lerp(260, 180, k);
  g.save(); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(40 + 14, y + 18, SHEET.w, SHEET.h); g.restore();
  g.globalAlpha = k; g.drawImage(SHEET.first, 40, y); g.globalAlpha = 1;
  if (u >= 0.75) strike(g, SHEET.sheet, u - 0.75, { x: 40, y, w: SHEET.w, h: SHEET.h }); } };
// release: the commutation stamped across the photograph
const RELEASE = daterStamp({ faces: { ring: F.oswald, word: F.shoulders }, word: 'COMMUTED.', ring: ['RELEASED', ''], rcap: 70, date: 'DEC 25 1921 · NOT PARDONED', cx: 540, cy: 1250, R0: 430, cap: 150, rot: 0.07 });
// dates: three rows set as type
const DROWS = SH.dates.s.extra.rows.map((r, i) => ({ ...r, D: setting(r.date, { font: F.anton, cap: 150, y: 520 + i * 420, x: 80, lh: 1 }), N: setting(r.note, { font: F.oswald, cap: 52, y: 640 + i * 420, x: 84, lh: 1 }) }));
if (DROWS[2]) { DROWS[2].D.words.forEach(w => w.red = true); DROWS[2].N.words.forEach(w => w.red = true); }

function sheet(g) { g.drawImage(paper, 0, 0); }
function dateline(g, s, y = 200) { const b = setBlock(F.oswald, [{ text: s, cap: 34, tracking: 0.12 }], { role: 'micro', x: 70, y, align: 'left', maxW: 940 }); g.fillStyle = INK; for (const q of b.glyphs) { g.save(); g.translate(q.ox, q.oy); g.fill(q.path); g.restore(); } g.fillRect(70, y + 26, 940, 3); }

// a cutdown (4 Oct: ONE IS IN, ELECTION DAY; scenes/one_is_in_vote.html sets window.OIP_CUT): output time plays these shots in turn;
// songs2/one_is_in_cut.py splices the score at the same shot boundaries
const OIP_CUT = window.OIP_CUT || null;
const cutT = to => { let o = 0; for (const id of OIP_CUT) { const d = SH[id].t1 - SH[id].t0; if (to < o + d || id === OIP_CUT[OIP_CUT.length - 1]) return SH[id].t0 + (to - o); o += d; } return to; };
window.renderFrame = async (tOut) => {
  const t = OIP_CUT ? cutT(tOut) : tOut;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  const at = id => t >= SH[id].t0 && t < SH[id].t1, u = id => t - SH[id].t0;
  if (at('hook')) G.hook.draw(ctx, t);
  else if (['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].some(at)) {
    sheet(ctx); const cur = CANTON.findIndex(c => at(c.id)), c = CANTON[cur];
    const scroll = Math.max(0, c.y0 + c.S.h - 1600) * ease.outCubic(clamp(u(c.id) / 0.6)) + (cur > 0 ? Math.max(0, CANTON[cur - 1].y0 + CANTON[cur - 1].S.h - 1600) * (1 - ease.outCubic(clamp(u(c.id) / 0.6))) : 0);
    ctx.save(); ctx.translate(0, -scroll);
    ctx.drawImage(WOOD.canton, 0, 0); dateline(ctx, 'CANTON, OHIO, JUNE 16, 1918. EUGENE V. DEBS.');
    CANTON.forEach((k, i) => { if (i < cur) drawSetting(ctx, k.S, 99, 1); else if (i === cur) drawSetting(ctx, k.S, u(k.id), (SH[k.id].t1 - SH[k.id].t0) * 0.6); });
    ctx.restore();
  } else if (at('ask')) {
    const ua = u('ask'), ans = TL.marks.answer - SH.ask.t0;
    if (ua < ans) { sheet(ctx); dateline(ctx, 'CANTON, OHIO, JUNE 16, 1918.'); drawSetting(ctx, ASK, ua, 0.9); }
    else ANS.draw(ctx, ua);
  } else if (at('door')) { const ud = u('door'); sheet(ctx); dateline(ctx, 'THE SAME SPEECH.', 200); drawSetting(ctx, DOOR, ud, 0.6);
    chase(ctx, clamp((ud - DX.t) / 0.4)); drawSetting(ctx, IN, ud - DX.t1, 0.4);
    if (ud >= DX.t2) { const k = clamp((ud - DX.t2) / 1.0), jit = Math.sin((ud - DX.t2) * 38) * 5 * (1 - Math.abs(k - 0.7));
      ctx.save(); ctx.translate(0, -ease.outCubic(k) * 40 + jit); drawSetting(ctx, OUT, ud - DX.t2, 0.7); ctx.restore(); }
    drawSetting(ctx, ONLY, ud - DX.t3, 1.4); }
  else if (at('free')) { ctx.drawImage(WOOD.canton, 0, 0); dateline(ctx, 'THE SAME SPEECH.'); drawSetting(ctx, FREE, u('free'), 3.0); }
  else if (at('arrest')) { sheet(ctx); ARREST.draw(ctx, u('arrest') - 0.08); }          // v3: the stamp lands at once (v2 held 0.5 s of empty paper)
  else if (at('court')) { ctx.drawImage(WOOD.atlanta, 0, 0); dateline(ctx, 'TO THE COURT, CLEVELAND, SEPTEMBER 18, 1918.'); drawSetting(ctx, COURT, u('court'), 6.0); }
  else if (at('pins')) { PUNCH.draw(ctx, t); const b = setBlock(F.oswald, [{ text: 'FOR PRESIDENT: CONVICT NO.', cap: 52, tracking: 0.08 }], { role: 'micro', x: 540, y: 520, maxW: 940 });
    ctx.fillStyle = '#e8e2d2'; for (const q of b.glyphs) { ctx.save(); ctx.translate(q.ox, q.oy); ctx.fill(q.path); ctx.restore(); } }
  else if (at('board')) BOARD.draw(ctx, u('board'));
  else if (at('release')) { ctx.drawImage(WOOD.release, 0, 0); RELEASE.draw(ctx, u('release') - 0.6); }
  else if (at('dates') || at('mark')) {
    sheet(ctx); const ud = t - SH.dates.t0;
    DROWS.forEach(r => { drawSetting(ctx, r.D, ud - r.t, 0.25); drawSetting(ctx, r.N, ud - r.t - 0.35, 0.4); });
    if (at('mark')) { const ex = SH.mark.s.extra, um = u('mark'); if (um >= ex.lock) { const age = um - ex.lock; ctx.fillStyle = `rgba(10,8,6,${clamp(age * 4, 0, 0.94)})`; ctx.fillRect(0, 0, W, H); closer(ctx, age); } }
  } else { ctx.fillStyle = '#0a0806'; ctx.fillRect(0, 0, W, H); const age = t - SH.mark.t0 - SH.mark.s.extra.lock; closer(ctx, Math.max(0, age)); }
  finish.apply(ctx, Math.round(t * 30), { grain: 0.05, vignette: 0.35 });
  return {};
};
ready = true;
