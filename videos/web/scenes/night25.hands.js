// THE NIGHT OF 25 OCTOBER: the one pair of clock hands (2D, any canvas). Cream spades with an ink edge, after the Petersburg dial's own hands in
// October (1928). A fast turn is drawn as its sweep over the shutter: copies spread across the angle it travels in the frame, so a hand that turns
// faster than the frame becomes a disc of light (the turns at the end) instead of strobing.
//   drawHands(g, { x, y, minute: len px, hour: len px, width: the ink edge scale, aHour, aMin, sweepHour, sweepMin, alpha })   degrees, 0 = XII, clockwise
export const CREAM = '#EFE6CF', INK = '#15110F';

// the outlines, as half-widths along the hand (s: 0 at the arbor, -1 at the tip, + behind it), unit length
const MIN_W = s => s > 0 ? 0.03 : s > -0.56 ? 0.022 - 0.008 * (-s / 0.56) : s > -0.9 ? (() => { const u = (-s - 0.56) / 0.34; return 0.006 + 0.008 * (1 - u) + 0.056 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 1.1); })() : 0.006 - 0.004 * (-s - 0.9) / 0.1;
const HOUR_W = s => s > 0 ? 0.045 : s > -0.36 ? 0.036 - 0.008 * (-s / 0.36) : (() => { const u = (-s - 0.36) / 0.5; return Math.max(0, (0.028 * (1 - u) + 0.105 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 1.05)) * (u > 0.92 ? (1 - u) / 0.08 : 1)); })();
// a closed outline (half-width, s): s from the tail (+) to the tip (-1); on the canvas y = s x len, so a hand at 0 degrees points up
function outline(wf, s0, s1, n = 72) {
  const R = [];
  for (let i = 0; i <= n; i++) { const s = s0 + (s1 - s0) * i / n; R.push([wf(s), s]); }
  return R.concat(R.slice().reverse().map(([w, s]) => [-w, s]));
}
const MIN_PTS = outline(MIN_W, 0.16, -1.0), HOUR_PTS = outline(HOUR_W, 0.14, -0.86);
export const HAND_SHAPES = { minute: MIN_PTS, hour: HOUR_PTS, minW: MIN_W, hourW: HOUR_W };
// one hand at an angle (degrees from XII, clockwise), len px (its breadth goes with its length); edge: the ink line in px (0: none)
function hand(g, pts, x, y, a, len, edge) {
  g.save(); g.translate(x, y); g.rotate(a * Math.PI / 180);
  g.beginPath(); pts.forEach(([w, s], i) => (i ? g.lineTo(w * len, s * len) : g.moveTo(w * len, s * len))); g.closePath();
  g.fill(); if (edge) { g.lineWidth = edge; g.strokeStyle = INK; g.stroke(); }
  g.restore();
}
// copies across the sweep: n from the travel (one a 5 degrees, at most 48); past a full turn the copies cover the whole circle
export function sweepCopies(sweep) { const s = Math.abs(sweep); if (s < 2.5) return { n: 1, span: 0 }; const span = Math.min(360, s); return { n: Math.min(48, Math.max(2, Math.ceil(span / 5))), span: Math.sign(sweep) * span }; }
export function drawHands(g, { x, y, minute, hour, width = 1, aHour, aMin, sweepHour = 0, sweepMin = 0, alpha = 1 }) {
  if (alpha <= 0.002 || minute < 0.5) return;
  const edge = Math.max(1.2, 2.4 * width);
  g.save(); g.globalAlpha = alpha; g.fillStyle = CREAM;
  for (const [pts, a, sw, len] of [[HOUR_PTS, aHour, sweepHour, hour], [MIN_PTS, aMin, sweepMin, minute]]) {
    const { n, span } = sweepCopies(sw);
    if (n === 1) { hand(g, pts, x, y, a, len, edge); continue; }
    // a blur: the copies share the hand's coverage; the sharp end of the sweep (where it is now) is drawn a little stronger
    const each = Math.min(1, 1.8 / n);
    for (let i = 0; i < n; i++) { g.globalAlpha = alpha * each * (i === n - 1 ? 1.6 : 1); hand(g, pts, x, y, a - span * (1 - i / (n - 1)), len, 0); }
    g.globalAlpha = alpha;
  }
  // the arbor
  const r = Math.max(2, 0.055 * minute);
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.lineWidth = edge; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.arc(x, y, r * 0.3, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
  g.restore();
}
