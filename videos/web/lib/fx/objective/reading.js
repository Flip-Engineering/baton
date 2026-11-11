// OBJECTIVE / reading (Oct 2026; the series engine, BIBLE section 4): the instrument's measured number in its own voice. One line of Plex Mono
// caps at the left edge of the safe band, arriving with the line it belongs to; never a counter, a chart or a label of what is shown.
//   drawReading(ctx, 'SKIN · ≈ 50 TONS PER SQ IN', { x: 60, y: 1236, size: 28, alpha })
// The studio's Plex Mono subset (fontsource latin) has no U+2248; the sign is drawn here as two waves on the mono's own advance and
// stroke weight, so the reading keeps its verbatim character instead of falling back to another face.
export const READING = { x: 60, y: 1236, size: 28, color: '#f4efe6', family: 'Plex Mono', tracking: 0.04 };

function approx(ctx, x, y, size, adv, color) {
  const w = adv * 0.78, x0 = x + (adv - w) / 2, lw = Math.max(1.5, size * 0.075), mid = y - size * 0.34, gap = size * 0.13, amp = size * 0.055;
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  for (const dy of [-gap, gap]) { ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const u = i / 24, px = x0 + w * u, py = mid + dy - amp * Math.sin(u * Math.PI * 2); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.stroke(); }
  ctx.restore();
}
// draws the reading; returns its width in px
export function drawReading(ctx, text, o = {}) {
  const R = { ...READING, ...o }, a = R.alpha ?? 1; if (a <= 0) return 0;
  ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = R.color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.font = `400 ${R.size}px "${R.family}"`;
  const adv = ctx.measureText('0').width + R.size * R.tracking;
  let x = R.x;
  for (const ch of text) { if (ch === '≈') approx(ctx, x, R.y, R.size, adv, R.color); else if (ch !== ' ') ctx.fillText(ch, x, R.y); x += adv; }
  ctx.restore();
  return x - R.x;
}
