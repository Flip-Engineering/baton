// BANDS (7 Oct 2026): the house type, shared. Solid type on a solid band, complete on its hit frame and struck in (in from 116 %, a two-frame
// squash, settle). BASIC LAW, FLINT and FROM THE SKIES each carried a copy; new pieces use this.
//
//   import { loadBands, cueType } from '../lib/fx/bands.js';
//   await loadBands();
//   const CUES = [[from, to, ['LINE ONE', 'LINE TWO'], y, size, 'main' | 'hot' | 'red' | 'sub'], ...];   // from/to in the piece's units
//   cueType(g, now, CUES, { toS: b => b * 0.5 });
import { clamp } from '../kit.js';

export const FONT = '"Big Shoulders Display", "Anton", sans-serif';
export const STOCK = '#EFE6CF', INK = '#15110F', HRED = '#C8141E';
let loaded = false;
export async function loadBands() {
  if (loaded) return; loaded = true;
  const f = new FontFace('Big Shoulders Display', 'url(../node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2)', { weight: '900' });
  document.fonts.add(await f.load());
}
function fit(g, text, size, maxW) { g.font = `900 ${size}px ${FONT}`; const w = g.measureText(text).width; return w > maxW ? size * maxW / w : size; }
export function band(g, text, x, y, size, { fill = STOCK, back = INK, a = 1, strike = 1, maxW = 902 } = {}) {
  const s = fit(g, text, size, maxW); g.save(); g.globalAlpha = a; g.font = `900 ${s}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.letterSpacing = `${Math.round(s * 0.012)}px`;
  const w = g.measureText(text).width, padX = s * 0.22, padY = s * 0.16;
  g.translate(x, y - s * 0.36); g.scale(strike, strike); g.translate(-x, -(y - s * 0.36));
  g.fillStyle = back; g.fillRect(x - w / 2 - padX, y - s * 0.92 - padY * 0.4, w + 2 * padX, s * 0.92 + padY * 1.4);
  g.fillStyle = fill; g.fillText(text, x, y); g.restore();
}
export const STYLES = { main: { fill: STOCK, back: INK }, hot: { fill: HRED, back: STOCK }, red: { fill: STOCK, back: HRED }, sub: { fill: INK, back: STOCK } };
export function cueType(g, now, cues, { toS = x => x, x = 540 } = {}) {
  for (const [a, e, lines, y, size, style] of cues) {
    if (now < a || now >= e) continue;
    const age = toS(now) - toS(a), al = clamp((toS(e) - toS(now)) / 0.08), fr = age * 30;
    const strike = style === 'sub' ? 1 : fr < 3 ? 1.16 - 0.16 * fr / 3 : fr < 5 ? 1 - 0.03 * Math.sin((fr - 3) / 2 * Math.PI) : 1;
    lines.forEach((tx, i) => band(g, tx, x, y + i * size * 1.22, size, { ...STYLES[style || 'main'], a: al, strike }));
  }
}
