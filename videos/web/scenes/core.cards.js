// THE CORE (TRUE SCALE ep. 1): the words. Black ink printed on transformer pressboard, the trade's own insulating board, in the series
// face (Barlow Condensed, OFL: 600 statements, 800 figures, 500 source lines; the woff files in assets/core/fonts, opentype.js reads
// them). The strings come from assets/core/cards.json, generated from research/scripts_final/core.json (labs/truescale/core_cards.mjs).
// Card 1 is a board in the world, carried by the crew at frame 0; the rest are pressboard strips laid in like laminations
// (corestack cardQuad), each covered by the next.
import { parse as otParse } from '../node_modules/opentype.js/dist/opentype.mjs';
import { pressboardCard } from '../lib/fx/truescale/corestack.js';
import { CARDS } from './core.plan.js';

const W = 1080;
const url = p => new URL(p, import.meta.url);
export async function loadFaces() {
  const one = async w => otParse(await (await fetch(url(`../assets/core/fonts/barlow-condensed-latin-${w}-normal.woff`))).arrayBuffer());
  const [f5, f6, f8] = await Promise.all([one(500), one(600), one(800)]);
  return { 500: f5, 600: f6, 800: f8 };
}
export async function loadCards() { return (await (await fetch(url('../assets/core/cards.json'))).json()).cards; }

// a line's width in px at a cap height
export function lineWidth(font, text, cap) {
  const upm = font.unitsPerEm, capU = (font.tables.os2 && font.tables.os2.sCapHeight) || upm * 0.7, size = cap * upm / capU;
  const gl = [...text].map(ch => font.charToGlyph(ch)); let w = 0;
  gl.forEach((g, i) => { w += (g.advanceWidth + (i < gl.length - 1 ? font.getKerningValue(g, gl[i + 1]) : 0)) * size / upm; });
  return w;
}
// the figure lines (800): where the number is the point
const FIGURE = { 1: [2], 2: [0, 1], 3: [0, 1], 6: [1], 7: [1], '5b': [2], '8a': [2], '8b': [0] };

// ---------------------------------------------------------------- card 1: the board the crew holds (2.70 x 1.30 m; printed at 600 px/m)
// Frame 0 (brief): left-aligned at x 175 on a board spanning x 135-945, y 900-1290 at 300 px/m: A POWER TRANSFORMER. (600, cap 70, base
// y 1010), ORDER ONE, (600, cap 70, 1100), WAIT 128 WEEKS. (800, cap 96, 1215), the source (500, cap 20, 1268). Fitted to the board.
export function hookBoard(F, card, { canvas = null } = {}) {
  const k = 2, bx = 135, by = 900, Wb = 810, Hb = 390, x = (175 - bx) * k, maxW = (Wb - (175 - bx) - 26) * k;
  const spec = [[card.lines[0], 600, 70, 1010], [card.lines[1], 600, 70, 1100], [card.lines[2], 800, 96, 1215], [card.credit, 500, 20, 1268]];
  // one scale for the three statement lines if any is wider than the board allows (the figure stays the biggest)
  let s = 1; for (const [tx, w, cap] of spec.slice(0, 3)) s = Math.min(s, maxW / (lineWidth(F[w], tx, cap * k) || 1));
  const lines = spec.map(([text, w, cap, base], i) => ({ text, font: F[w], cap: cap * k * (i < 3 ? s : 1), x, base: (base - by) * k }));
  const card1 = pressboardCard({ lines, w: Wb * k, h: Hb * k, seed: 1, canvas });
  card1.fit = s;
  return card1;
}

// ---------------------------------------------------------------- the strips: a band across the frame, the mitre at the leading end
// L: text from x 84, the strip running off the left edge, its mitre at the right (resting with 0.6 h past the frame's edge at the top,
// 0.4 h inside it at the bottom); R: the mirror (text from x 186). Statements at cap 54 (shrunk to fit, not below 38), figures at the
// same cap in 800, the source line at cap 21 in 500. The strip's height follows its lines.
export function stripCard(F, card, plan, { canvas = null, reach = 0.6 } = {}) {
  const fig = FIGURE[card.n] || [], L = plan.edge === 'L', capS = 54, lead = 1.48, padT = 40, padB = 34, credCap = 21;
  const nL = card.lines.length, hText = padT + capS + (nL - 1) * capS * lead + (card.credit ? 22 + credCap * 1.4 : 0) + padB;
  const h = Math.max(plan.h ? Math.min(plan.h, 520) : 0, Math.round(hText));
  const x0 = L ? 84 : 186;
  // the room each line has: up to the mitre at its baseline (with a 28 px margin), and never past x 1000 / short of the mitre on the left
  const mitreX = yy => L ? W + reach * h - yy : -reach * h + (h - yy);       // yy from the strip's top
  let cap = capS;
  const fits = c => card.lines.every((tx, i) => { const base = padT + c + i * c * lead, w = lineWidth(F[fig.includes(i) ? 800 : 600], tx, c);
    return L ? x0 + w <= Math.min(1000, mitreX(base) - 28) : x0 >= mitreX(base - c) + 28 && x0 + w <= 1000; });
  while (cap > 38 && !fits(cap)) cap -= 1;
  const lines = card.lines.map((tx, i) => ({ text: tx, font: F[fig.includes(i) ? 800 : 600], cap, x: x0 + (L ? 80 : h), base: padT + cap + i * cap * lead }));
  if (card.credit) lines.push({ text: card.credit, font: F[500], cap: credCap, x: x0 + (L ? 80 : h), base: padT + cap + (nL - 1) * cap * lead + 22 + credCap * 1.25 });
  const cw = W + h + 80, c = pressboardCard({ lines, w: cw, h, seed: 10 + (typeof card.n === 'number' ? card.n : 8), canvas, edge: true });
  // the canvas spans x from -80 (L) or -h (R) in screen px
  return { ...c, n: card.n, at: [L ? -80 : -h, plan.y], y: plan.y, h, edge: plan.edge, cap, fits: fits(cap), reach };
}

export async function buildCards({ canvas = null } = {}) {
  const [F, cards] = await Promise.all([loadFaces(), loadCards()]);
  const byN = new Map(cards.map(c => [String(c.n), c]));
  const hook = hookBoard(F, byN.get('1'), { canvas: canvas?.() });
  const strips = CARDS.map(p => ({ plan: p, card: stripCard(F, byN.get(String(p.n)), p, { canvas: canvas?.() }) }));
  return { F, cards, hook, strips };
}
