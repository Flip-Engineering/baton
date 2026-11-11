// AT REST: the words (the series' type, BIBLE section 6): IBM Plex Sans Condensed SemiBold (OFL, assets/objective/fonts), white, sentence case,
// flush left at x 72 inside the safe band, between y 300 and 760; the hook at 72 px cap height, quotations at 56 px. Each line arrives
// whole on its beat; a card clears whole. Credits and readings in Plex Mono caps (26-30 px). No band, plate, glow, stroke or kinetic trick.
// The mark: the house four-stripe ACP mark (kit.js acpEmblem), upright, 220 px, in the dawn sky over the stacks, ACP.US in Plex Mono
// beneath; its ink is the house red over a pale sky and cream over a dark one (read from the picture under it), never a plate.
import { acpEmblem, C, loadFonts } from '../lib/kit.js';
import { drawReading } from '../lib/fx/objective/reading.js';
import * as P from './atrest.plan.js';

export const COND = 'Plex Cond';
export const CAP = 0.698;                                     // IBM Plex Sans Condensed cap height (698/1000 em)
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export async function loadType() {
  await loadFonts();                                          // Plex Mono (and the house faces), the brand mark
  const f = new FontFace(COND, 'url(../assets/objective/fonts/ibm-plex-sans-condensed-latin-600-normal.woff2)', { weight: '600' });
  document.fonts.add(await f.load());
}
// a card's size: the cap height asked for, smaller only if a line is wider than the band or the card taller than its room
export function cardLayout(ctx, card) {
  const T = P.TYPE, cap = card.kind === 'hook' ? T.capHook : T.capQ, lead = card.kind === 'hook' ? 1.16 : 1.14;
  let size = cap / CAP;
  ctx.font = `600 ${size}px "${COND}"`;
  const wMax = Math.max(...card.lines.map(l => ctx.measureText(l.text).width));
  if (wMax > T.maxW) size *= T.maxW / wMax;
  const room = T.y1 - T.y0, need = size * CAP + (card.lines.length - 1) * size * lead;
  if (need > room) size *= room / need;
  return { size, lead: size * lead, y0: T.y0 + size * CAP };
}
const cache = new Map();
export function drawWords(ctx, t) {
  const T = P.TYPE;
  for (const w of P.wordsAt(t)) {
    const card = P.CUES.find(c => c.id === w.id);
    if (!cache.has(card.id)) cache.set(card.id, cardLayout(ctx, card));
    const L = cache.get(card.id);
    ctx.save(); ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.font = `600 ${L.size}px "${COND}"`;
    const fadeOut = clamp((w.t0 === card.t0 ? card.t1 - t : 1) / 0.07);
    let y = L.y0;
    for (const l of w.lines) { ctx.globalAlpha = clamp((t - l.t) / 0.067) * fadeOut; ctx.fillText(l.text, T.x, y); y += L.lead; }
    if (w.credit) { const c0 = w.lines[w.lines.length - 1].t; ctx.globalAlpha = clamp((t - c0) / 0.067) * fadeOut; ctx.fillStyle = '#e9e3d6';
      ctx.font = `400 ${T.credit}px "Plex Mono"`; drawTracked(ctx, w.credit, T.x, y - L.lead + 26 + T.credit * 1.5, 0.06 * T.credit); }
    ctx.restore();
  }
  const r = P.readingAt(t);
  if (r) drawReading(ctx, r.text, { x: T.rx, y: T.ry, size: T.reading, alpha: clamp((t - r.t0) / 0.067) * clamp((r.t1 - t) / 0.067) });
}
function drawTracked(ctx, s, x, y, track) { for (const ch of s) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + track; } }

// the mark, set into the plain image: cream or the house red by what is under it (mean luminance of the picture where it sits)
export function drawMark(ctx, t, under = null) {
  if (t < P.MARK.t0) return;
  const a = clamp((t - P.MARK.t0) / 0.034), M = P.MARK, light = under != null && under > 0.55;
  const ink = light ? null : C.cream;                        // null: the logo's own red
  acpEmblem(ctx, P.W / 2, M.y, M.size, { color: ink, alpha: a });
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = light ? '#7a0f12' : C.cream; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = `400 40px "Plex Mono"`; const s = 'ACP.US', tr = 4; let w = 0; for (const ch of s) w += ctx.measureText(ch).width + tr; w -= tr;
  drawTracked(ctx, s, P.W / 2 - w / 2, M.y + M.size * 0.62 + 46, tr);
  ctx.restore();
}
