// BREAD! BREAD! (16 Oct 2026, new piece, for Veterans Day, 11 Nov). The empire's own architect says why empire exists: in 1895 Cecil Rhodes
// heard the unemployed cry "bread! bread!" and went home convinced of imperialism, because "If you want to avoid civil war, you must become
// imperialists" (Lenin, Imperialism, ch. 6). The crowd answers twice, in Los Angeles in 1933 and over I-205 in 2026, and the Party closes with
// its own Veterans Day line (11 Nov 2024): the only legitimate American war it recognizes is the class war.
//
// The whole piece is one cyanotype sheet (lib/printlab.js: Prussian blue measured from the Atkins prints, a brushed coating, the wash as a
// moving water front). The film is printed through it as a negative; the words are masks on the same sheet (paper white, letters exposed
// blue) and the crowd's own words are screen-printed red on top. Under Rhodes every print is left UNWASHED: grey on a sour yellow-green, the
// latent image. When the 1933 crowd answers, the water front runs down the sheet and the print develops into deep blue. It deepens (oxidises)
// to the end. At the mark the sheet is lifted off the exposure: the last four bands become the four stripes on bare paper.
//
// Film: Universal Newsreel Vol. 2, Release 29 (9 Apr 1930, NARA 234271494; public domain since 1 Jan 2026) and the Los Angeles relief workers'
// demonstration (1933, Prelinger, public domain). Plates: assets/bread/reel.json (scripts/reelbake.py). Score: songs2/bread_e.py, 72 BPM.
import { W, H, loadFonts, outCanvas, clamp, lerp, ease as KE } from '../lib/kit.js';
const ease = { ...KE, inOutSine: x => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x)) };
import { Reel } from '../lib/fx/reel.js';
import { PrintLab } from '../lib/printlab.js';
import { drawMark, markBox, drawLockup } from '../lib/closer.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts();
const BIG = '"Big Shoulders Display", "Anton", sans-serif', MONO = '"IBM Plex Mono", monospace';
for (const [fam, file, wt] of [['Big Shoulders Display', 'big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2', '900'],
  ['IBM Plex Mono', 'ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', '500'], ['IBM Plex Mono', 'ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2', '700']]) {
  const f = new FontFace(fam, `url(../node_modules/@fontsource/${file})`, { weight: wt }); document.fonts.add(await f.load());
}
const SPB = 60 / 72, BT = x => x * SPB;

export const TL = { hook: 0, sheet: 6, rhodes: 15, r2: 18, r3: 21, r4: 26, r5: 30, r6: 32.5, la: 35.5, signs: 37.5, heroes: 38, placard: 42, turn: 42.5,
  hands: 44.5, oregon: 46.5, ban1: 47, ban2: 49.5, party: 53, p2: 56.5, p3: 60, classwar: 63, victory: 67, supremacy: 71, mark: 75.5, end: 81 };

// ------------------------------------------------------------------ the film: windows on the sheet
const reel = await Reel.load('../assets/bread/plates');
const WIN = { tall: { x: 0, y: 190, w: 1080, h: 1440 }, wide: { x: 0, y: 1000, w: 1080, h: 810 }, bg: { x: -740, y: 0, w: 2560, h: 1920 } };
const CUTS = Reel.cuts([
  [0, 'river', { win: 'tall', rate: 0.45, z: [1.0, 1.06] }],
  [TL.sheet, 'line', { win: 'bg', rate: 0.6, z: [1.0, 1.04] }],
  [TL.rhodes, 'mass', { win: 'wide', rate: 0.55, z: [1.02, 1.08] }],
  [TL.r2, 'riverw', { win: 'wide', rate: 0.5, z: [1.0, 1.05] }],
  [TL.r3, 'feet', { win: 'wide', rate: 0.45, z: [1.0, 1.04] }],
  [TL.r4, 'line', { win: 'wide', off: 1.0, rate: 0.35, z: [1.0, 1.05] }],
  [TL.r5, 'riverw', { win: 'wide', off: 2.4, rate: 0.2, z: [1.05, 1.12] }],
  [TL.r6, 'riverw', { win: 'wide', hold: 70, z: [1.12, 1.16] }],                 // the view from above, frozen
  [TL.la, 'horns', { win: 'wide', rate: 1, z: [1.0, 1.05] }],
  [TL.signs, 'signs', { win: 'wide', rate: 0.85, z: [1.0, 1.12], cy: 0.4 }],
  [TL.placard, 'placard', { win: 'wide', rate: 0.9, z: [1.0, 1.1], cy: 0.55 }],
  [TL.hands, 'hands', { win: 'wide', rate: 1, z: [1.0, 1.05] }],
  [TL.party, 'river', { win: 'tall', rate: 1, z: [1.0, 1.05] }],
  [TL.p3, 'mass', { win: 'tall', off: 1.0, rate: 1, z: [1.0, 1.04] }],
  [TL.classwar, 'faces', { win: 'tall', rate: 1, z: [1.0, 1.06] }],
  [TL.victory, 'horns', { win: 'tall', rate: 0.9, z: [1.0, 1.05] }],
  [TL.supremacy, 'river', { win: 'tall', off: 1.2, rate: 0.7, z: [1.04, 1.12] }],
], BT, BT(TL.mark));
const HP = {};
const WC = {}; for (const k in WIN) { const r = WIN[k]; WC[k] = Object.assign(document.createElement('canvas'), { width: Math.max(1, r.w), height: r.h }); }

// The sheet's exposure (TR: white = full UV through the negative = Prussian blue; black = masked = paper white) and the red screen (STEN).
const TRC = Object.assign(document.createElement('canvas'), { width: W, height: H }), TG = TRC.getContext('2d');
const STC = Object.assign(document.createElement('canvas'), { width: W, height: H }), SG = STC.getContext('2d');
const lab = await PrintLab.create();
const CAM = { view_mm: 380, x_mm: 0, y_mm: 0 };

async function plate(b) {
  const t = BT(b), c = Reel.at(CUTS, t); if (!c) return null;
  const k = c.o.win || 'wide', r = WIN[k], g = WC[k].getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, r.w, r.h);
  const res = await reel.draw(g, t, CUTS, { rect: { x: 0, y: 0, w: r.w, h: r.h }, ease: ease.inOutSine });
  // local contrast before printing (a high-pass overlaid on the frame), so the caps and faces of a dark crowd separate on the sheet
  const hp = HP[k] ||= Object.assign(document.createElement('canvas'), { width: Math.max(1, r.w), height: r.h }), hg = hp.getContext('2d');
  hg.globalAlpha = 1; hg.filter = 'none'; hg.drawImage(WC[k], 0, 0);
  hg.globalAlpha = 0.5; hg.filter = `blur(${Math.round(r.w / 40)}px) invert(1)`; hg.drawImage(WC[k], 0, 0); hg.filter = 'none'; hg.globalAlpha = 1;
  g.save(); g.globalCompositeOperation = 'overlay'; g.drawImage(hp, 0, 0); g.drawImage(hp, 0, 0); g.restore();
  // a negative of the frame, so the shadows of the street print blue
  TG.save(); TG.filter = 'grayscale(1) invert(1) brightness(0.8) contrast(1.9)'; TG.drawImage(WC[k], r.x, r.y); TG.restore();
  if (k !== 'bg') { TG.strokeStyle = '#000'; TG.lineWidth = 10; TG.strokeRect(r.x + 5, r.y + 5, r.w - 10, r.h - 10); }   // the mask's edge
  return { ...res, win: k };
}

// ------------------------------------------------------------------ the words: masks on the sheet, the crowd's in red
// style 'ink': a paper-white band with the letters exposed blue; 'red': a red screen band with the letters knocked out to paper; 'sub': small ink
function fit(text, size, maxW, font = BIG, wt = 900) { TG.font = `${wt} ${size}px ${font}`; const w = TG.measureText(text).width; return w > maxW ? size * maxW / w : size; }
function band(text, x, y, size, style, a = 1, strike = 1, { maxW = 940, font = BIG, wt = 900 } = {}) {
  const s = fit(text, size, maxW, font, wt);
  TG.font = SG.font = `${wt} ${s}px ${font}`; TG.textAlign = SG.textAlign = 'center'; TG.textBaseline = SG.textBaseline = 'alphabetic';
  const w = TG.measureText(text).width, padX = s * 0.2, padY = s * 0.14;
  const rx = x - w / 2 - padX, ry = y - s * 0.9 - padY * 0.4, rw = w + 2 * padX, rh = s * 0.9 + padY * 1.4;
  for (const g of [TG, SG]) { g.save(); g.translate(x, y - s * 0.36); g.scale(strike, strike); g.translate(-x, -(y - s * 0.36)); g.globalAlpha = a; }
  TG.fillStyle = '#000'; TG.fillRect(rx, ry, rw, rh);
  if (style === 'red') { SG.fillStyle = '#fff'; SG.fillRect(rx, ry, rw, rh); SG.fillStyle = '#000'; SG.fillText(text, x, y); }
  else { TG.fillStyle = '#fff'; TG.fillText(text, x, y); }
  TG.restore(); SG.restore();
  return { x0: rx, y0: ry, x1: rx + rw, y1: ry + rh };
}
// cues: [from, to, lines, y, size (or per-line sizes), style]
function cues(b, list) {
  const rects = [];
  for (const [a, e, lines, y, size, style] of list) {
    if (b < a || b >= e) continue;
    const age = BT(b) - BT(a), al = clamp((BT(e) - BT(b)) / 0.08) * clamp(age / 0.04 + 0.5), fr = age * 30;
    const strike = style === 'sub' ? 1 : fr < 3 ? 1.12 - 0.12 * fr / 3 : fr < 5 ? 1 - 0.025 * Math.sin((fr - 3) / 2 * Math.PI) : 1;
    let yy = y;
    lines.forEach((tx, i) => {
      const s = Array.isArray(size) ? size[i] : size;
      rects.push(band(tx, 540, yy, s, style === 'sub' ? 'ink' : style, al, strike));
      yy += s * 1.2;
    });
  }
  return rects;
}
const CUES = [
  [TL.hook, TL.sheet, ['BREAD!', 'BREAD!'], 930, 260, 'red'],
  [TL.hook + 2.5, TL.sheet, ['NEW YORK, 1930'], 300, 44, 'sub'],
  // Rhodes, to W. T. Stead, 1895, as quoted by Lenin (Imperialism, ch. 6). Left unwashed: the latent print.
  [TL.rhodes, TL.r2, ['I LISTENED', 'TO THE WILD SPEECHES,'], 470, 120, 'ink'],
  [TL.r2, TL.r3, ['WHICH WERE JUST A CRY', 'FOR ‘BREAD! BREAD!’'], 470, 112, 'ink'],
  [TL.r3, TL.r4, ['… I BECAME', 'MORE THAN EVER CONVINCED', 'OF THE IMPORTANCE', 'OF IMPERIALISM.'], 400, 100, 'ink'],
  [TL.r4, TL.r5, ['THE EMPIRE,', 'AS I HAVE ALWAYS SAID,', 'IS A BREAD AND BUTTER', 'QUESTION.'], 400, 100, 'ink'],
  [TL.r5, TL.r6, ['IF YOU WANT', 'TO AVOID CIVIL WAR,'], 470, 120, 'ink'],
  [TL.r6, TL.la, ['YOU MUST BECOME', 'IMPERIALISTS.'], 470, 130, 'ink'],
  [TL.rhodes + 0.5, TL.la, ['CECIL RHODES, 1895', 'QUOTED BY LENIN, IMPERIALISM'], 1145, 40, 'sub'],
  // the crowd answers: Los Angeles, 1933 (its own placards)
  [TL.la + 0.5, TL.oregon, ['LOS ANGELES, 1933'], 1145, 44, 'sub'],
  [TL.heroes, TL.placard, ['HEROES OF 1917', 'BUMS OF 1933'], 500, 150, 'red'],
  [TL.turn, TL.oregon, ['TURN ALL', 'WAR FUNDS', 'OVER TO THE', 'UNEMPLOYED'], 400, 128, 'red'],
  // 2026: the dateline; the banners are drawn on the fence
  [TL.oregon, TL.party, ['OVER I-205, PORTLAND, OREGON', '21 SEPTEMBER 2026'], 330, 44, 'sub'],
  // the Party, Veterans Day statement, 11 Nov 2024
  [TL.party, TL.p2, ['THE PARTY STANDS WITH', 'THE ABANDONED VETERANS', 'OF THE UNITED STATES'], 430, 104, 'ink'],
  [TL.p2, TL.p3, ['AND FIGHTS TO SMASH', 'THE AMERICAN IMPERIALIST', 'WAR MACHINE.'], 430, 104, 'ink'],
  [TL.p3, TL.classwar, ['THE ONLY LEGITIMATE', 'AMERICAN WAR', 'IT RECOGNIZES'], 430, 116, 'ink'],
  [TL.classwar, TL.victory, ['IS THE', 'CLASS', 'WAR,'], 420, [110, 300, 300], 'red'],
  [TL.victory, TL.supremacy, ['AND THE ONLY VICTORY', 'IT RECOGNIZES', 'AS BELONGING TO', 'THE AMERICAN PEOPLE'], 400, 100, 'ink'],
  [TL.supremacy, TL.mark, ['IS THE POLITICAL', 'SUPREMACY OF', 'THE WORKING CLASS.'], 430, 116, 'ink'],
];
const CREDIT_PARTY = [TL.party + 0.3, TL.mark, ['AMERICAN COMMUNIST PARTY', 'VETERANS DAY, 11 NOV 2024'], 1235, 40, 'sub'];

// ------------------------------------------------------------------ the release sheet, re-set (NARA's catalogue transcription), on the print
function sheetPage(b) {
  const a = clamp((b - TL.sheet) / 0.4), x0 = 70, y0 = 300, x1 = 1010, y1 = 1250;
  TG.save(); TG.globalAlpha = a; TG.fillStyle = '#000'; TG.fillRect(x0, y0, x1 - x0, y1 - y0); TG.restore();
  const L = (txt, y, size, wt = 500, al = 1, x = x0 + 50) => { if (al <= 0) return; TG.save(); TG.globalAlpha = a * al; TG.fillStyle = '#fff'; TG.font = `${wt} ${size}px ${MONO}`; TG.textAlign = 'left'; TG.fillText(txt, x, y); TG.restore(); };
  const ap = k => clamp((b - k) / 0.15);
  L('UNIVERSAL NEWSREEL', y0 + 70, 34, 700); L('VOLUME 2, RELEASE 29 · RELEASED APRIL 9, 1930', y0 + 112, 25);
  TG.save(); TG.globalAlpha = a; TG.fillStyle = '#fff'; TG.fillRect(x0 + 50, y0 + 136, x1 - x0 - 100, 3); TG.restore();
  L('The original release sheet reads:', y0 + 185, 25, 500, ap(TL.sheet + 0.3));
  const i1 = ap(TL.sheet + 0.5);
  L('1. 150 PLANES BATTLE “ENEMY”', y0 + 262, 47, 700, i1); L('   IN ARMY’S BIGGEST WAR GAME', y0 + 318, 47, 700, i1);
  const s1 = ap(TL.sheet + 2.5);
  L('   MATHER FIELD, CA – Biggest array of', y0 + 380, 29, 500, s1); L('   fighting air craft ever assembled', y0 + 420, 29, 500, s1);
  L('   thrills thousands', y0 + 460, 29, 500, s1);
  const i2 = ap(TL.sheet + 4.5);
  L('2. STARVING THOUSANDS FILL', y0 + 580, 47, 700, i2); L('   BREAD LINE IN UNEMPLOYED', y0 + 636, 47, 700, i2); L('   CRISIS: NEW YORK CITY', y0 + 692, 47, 700, i2);
  L('Re-set from the National Archives', y0 + 870, 22, 500, a * 0.9); L('catalogue, record 234271494.', y0 + 902, 22, 500, a * 0.9);
  // the found pair: both THOUSANDS, underlined in red
  const u = clamp((b - (TL.sheet + 6.2)) / 0.5);
  if (u > 0) {
    TG.font = `500 29px ${MONO}`; const pre = TG.measureText('   thrills ').width, w1 = TG.measureText('thousands').width;
    TG.font = `700 47px ${MONO}`; const pre2 = TG.measureText('2. STARVING ').width, w2 = TG.measureText('THOUSANDS').width;
    SG.fillStyle = '#fff'; SG.fillRect(x0 + 50 + pre, y0 + 470, w1 * ease.outCubic(u), 7); SG.fillRect(x0 + 50 + pre2, y0 + 592, w2 * ease.outCubic(u), 9);
  }
}

// ------------------------------------------------------------------ 2026: two banners on the overpass fence over the night's traffic
// (an illustration of the chapter's banner drop, not its photograph; only the two signs named are lettered)
function night(b) {
  const t = BT(b), age = t - BT(TL.oregon);
  TG.fillStyle = '#fff'; TG.fillRect(0, 0, W, H);                        // night: full exposure, deep blue
  // the freeway below: lanes to a vanishing point; light trails (white = light, prints as paper)
  const vx = 540, vy = 1240;
  TG.save(); TG.globalCompositeOperation = 'source-over';
  for (let lane = -3; lane <= 3; lane++) {
    const dir = lane < 0 ? 1 : -1;                                       // towards us on the left, away on the right
    for (let k = 0; k < 7; k++) {
      const ph = ((t * (0.55 + 0.07 * Math.abs(lane)) * dir + k / 7 + lane * 0.13) % 1 + 1) % 1, z0 = 0.06 + ph * 0.94, z1 = z0 + 0.12 * (dir > 0 ? 1 : 0.6);
      const P = z => [vx + lane * 165 * z * z * 1.5, vy + 700 * z * z];
      const [ax, ay] = P(z0), [bx, by] = P(Math.min(1.1, z1));
      TG.strokeStyle = dir > 0 ? `rgba(0,0,0,${0.85})` : `rgba(0,0,0,${0.5})`; TG.lineCap = 'round';
      TG.lineWidth = (dir > 0 ? 9 : 5) * (0.3 + z0 * 1.4); TG.beginPath(); TG.moveTo(ax, ay); TG.lineTo(bx, by); TG.stroke();
    }
  }
  // the overpass deck and its parapet, then the chain-link fence above it
  TG.fillStyle = 'rgb(150,150,150)'; TG.fillRect(0, 1150, W, 110);
  TG.fillStyle = 'rgb(105,105,105)'; TG.fillRect(0, 1130, W, 22);
  TG.strokeStyle = 'rgba(0,0,0,0.42)'; TG.lineWidth = 2.2;
  for (let x = -600; x < W + 600; x += 34) { TG.beginPath(); TG.moveTo(x, 560); TG.lineTo(x + 570, 1130); TG.stroke(); TG.beginPath(); TG.moveTo(x + 570, 560); TG.lineTo(x, 1130); TG.stroke(); }
  TG.fillStyle = 'rgb(80,80,80)'; TG.fillRect(0, 552, W, 12); for (let x = 40; x < W; x += 250) TG.fillRect(x, 552, 12, 580);
  TG.restore();
  // the banners: drop from the top rail, unfurl, settle with a sway; cloth white with folds, letters screen-printed red
  const ban = (text, y0, startB, h) => {
    const u = clamp((b - startB) / 1.1); if (u <= 0) return;
    const hh = h * ease.outCubic(u), sway = Math.sin(t * 1.7 + y0) * 4 * u;
    const x0 = 46, x1 = W - 46;
    TG.save(); TG.beginPath(); TG.rect(x0, y0, x1 - x0, hh); TG.clip();
    TG.fillStyle = '#000'; TG.fillRect(x0, y0, x1 - x0, hh);                // white cloth
    for (let i = 0; i < 9; i++) {                                         // vertical folds (light shading of the cloth)
      const fx = x0 + (i + 0.5) * (x1 - x0) / 9 + sway * (i % 2 ? 1 : -1);
      const gr = TG.createLinearGradient(fx - 50, 0, fx + 50, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.13)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      TG.fillStyle = gr; TG.fillRect(fx - 50, y0, 100, hh);
    }
    TG.restore();
    // ties at the rail
    TG.fillStyle = 'rgb(60,60,60)'; for (const x of [x0 + 10, (x0 + x1) / 2, x1 - 22]) TG.fillRect(x, y0 - 14, 12, 22);
    if (u > 0.55) {
      const s = fit(text, h * 0.62, (x1 - x0) * 0.9); SG.save(); SG.globalAlpha = clamp((u - 0.55) / 0.2);
      SG.font = `900 ${s}px ${BIG}`; SG.textAlign = 'center'; SG.fillStyle = '#fff'; SG.fillText(text, W / 2 + sway * 0.5, y0 + h * 0.5 + s * 0.36); SG.restore();
      TG.save(); TG.font = `900 ${s}px ${BIG}`; TG.textAlign = 'center'; TG.globalAlpha = clamp((u - 0.55) / 0.2); TG.fillStyle = '#000'; TG.fillText(text, W / 2 + sway * 0.5, y0 + h * 0.5 + s * 0.36); TG.restore();
    }
  };
  ban('END THE FOREVER WARS', 600, TL.ban1, 230);
  ban('BRING BACK INDUSTRY', 870, TL.ban2, 230);
}

// ------------------------------------------------------------------ the mark: the last four bands become the four stripes, on bare paper
let lastRects = null;
function markEnd(b) {
  const age = BT(b) - BT(TL.mark);
  const cx = 540, cy = 860, size = 330, M = markBox(cx, cy, size);
  TG.fillStyle = '#000'; TG.fillRect(0, 0, W, H);                       // the sheet lifted: nothing more exposes
  const R = (lastRects || []).slice(0, 4); while (R.length < 4) R.push({ x0: 200, y0: 900, x1: 880, y1: 960 });
  const u = ease.inOutCubic(clamp(age / 0.9));
  SG.fillStyle = '#fff';
  R.forEach((r, k) => {
    const s = M.stripes[k], uk = ease.inOutCubic(clamp((age - k * 0.06) / 0.9));
    SG.fillRect(lerp(r.x0, s.x0, uk), lerp(r.y0, s.y0, uk), lerp(r.x1 - r.x0, s.x1 - s.x0, uk), lerp(r.y1 - r.y0, s.y1 - s.y0, uk));
  });
  const ba = clamp((age - 0.8) / 0.35);
  if (ba > 0) { SG.save(); drawMark(SG, cx, cy, size, { color: '#fff', badge: ba, stripes: [0, 0, 0, 0] }); SG.restore(); }
  if (u >= 1) { SG.save(); drawMark(SG, cx, cy, size, { color: '#fff', badge: ba, stripes: [1, 1, 1, 1] }); SG.restore(); }
  const la = clamp((age - 1.3) / 0.3);
  if (la > 0) { TG.save(); TG.globalAlpha = la; drawLockup(TG, 540, 1180, 110, { color: '#fff' }); TG.restore();
    TG.save(); TG.globalAlpha = clamp((age - 1.6) / 0.3); TG.font = `900 64px ${BIG}`; TG.textAlign = 'center'; TG.fillStyle = '#fff'; TG.fillText('ACP.US', 540, 1330); TG.restore(); }
}

// ------------------------------------------------------------------ the sheet's chemistry over time
function chem(b) {
  let wash = 1;
  if (b >= TL.rhodes && b < TL.la) wash = 0;                             // Rhodes: the latent print, never washed
  else if (b >= TL.la && b < TL.la + 2.5) wash = ease.inOutSine(clamp((b - TL.la) / 2.2));   // the crowd answers: the water front runs down
  const ox = b < TL.la ? 0.35 : lerp(0.35, 1, clamp((b - TL.la) / (TL.classwar - TL.la)));
  const dose = b >= TL.rhodes && b < TL.la ? 0.85 : 1;
  return { wash, oxidise: ox, dose };
}

// ------------------------------------------------------------------ the frame
window.renderFrame = async (t) => {
  const b = t / SPB;
  TG.setTransform(1, 0, 0, 1, 0, 0); SG.setTransform(1, 0, 0, 1, 0, 0);
  TG.globalAlpha = 1; SG.globalAlpha = 1; TG.filter = 'none';
  SG.fillStyle = '#000'; SG.fillRect(0, 0, W, H);
  if (b >= TL.mark) markEnd(b);
  else if (b >= TL.oregon && b < TL.party) { night(b); cues(b, CUES); }
  else {
    TG.fillStyle = '#fff'; TG.fillRect(0, 0, W, H);                      // the ground around the windows: exposed, blue
    await plate(b);
    if (b >= TL.sheet && b < TL.rhodes) sheetPage(b);
    // BREAD! breathes with the heartbeat
    const rects = cues(b, CUES);
    if (b >= TL.party) { const cr = cues(b, [CREDIT_PARTY]); if (b >= TL.supremacy) lastRects = rects.concat(cr); }
  }
  const C = chem(b);
  const sheet = lab.paper('whatman', CAM, 7);
  lab.cyanotype(sheet, TRC, { wash: C.wash, oxidise: C.oxidise, dose: C.dose, seed: 11 });
  lab.silkscreen(sheet, STC, { ink: 'screen_red', misreg: [0.25, -0.15, 0.05], seed: 5 });
  lab.draw(ctx, sheet);
  return {};
};
ready = true;
