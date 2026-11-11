// STYLE c3: FACES THAT READ AT FEED SIZE, in any style. A designer at 270 px does not shrink a face (its marks blur to a
// smudge or vanish): it states two eyes, the brows and the mouth as marks of a few pixels, placed where the face's own
// features are (hero.js inkStrokes: the lids, brows and mouth on the head and jaw bones, so they ride the pose), and lets the
// medium carry the rest. Above ~64 px (the head's height in pixels) the face is big enough for hero.js's own strokes, drawn as they are.
//
//   faceMarks(ctx, heroes, camera, { color, feedOnly: true })   // after any stage's render (DrawStage, PaintStage, StyleStage)
// feedOnly: only the small faces get marks (the drawn styles already draw hero.js's strokes on big ones); k: stroke weight.
// A canvas 2D pass of a few strokes a face: no pixel loop, ~0.1 ms a face.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
function mid(pts, a, b) { const n = pts.length - 1, i0 = Math.round(n * a), i1 = Math.round(n * b); return pts.slice(i0, i1 + 1); }
function stroke(g, pts, w, cap = 'round') { if (pts.length < 2) return; g.lineWidth = w; g.lineCap = cap; g.lineJoin = 'round'; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke(); }
// STYLE c5 (opt-in, nose: +1 the key from the left / -1 from the right): at feed size a nose too, the designer's tick on its shadow side
// (placed from the face's own marks: 38 % of the way from the mouth to the eyes), so a face at 30-60 px has a middle, not two dots and a line
export function faceMarks(g, heroes, camera, { color = '#141110', feedOnly = true, k = 0.8, W = g.canvas.width, H = g.canvas.height, minPx = 64, light = null, nose = 0 } = {}) {
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.strokeStyle = color; g.fillStyle = color;
  const out = [];
  for (const h of heroes) {
    if (!h || !h.inkStrokes || !h.group.visible) continue;
    // a face is 'small' by its own pixels, whatever the canvas (a 38 px head in a feed frame is small; line.js's own test scales with H)
    const tier = h.faceTier(camera, H), big = tier.px > minPx;
    if (big && feedOnly) continue;
    let S; try { S = h.inkStrokes(camera, W, H); } catch (e) { continue; }
    if (big) { for (const s of S) { if (s.ink !== 'ink') continue; stroke(g, s.pts, Math.max(0.9, s.w * k)); } out.push({ px: tier.px, mode: 'strokes', n: S.length }); continue; }
    // feed size: the head's px (faceTier: the head's height); a face of ~25-60 px. Marks in px, never under ~1 px
    const sc = clamp(tier.px / 50, 0.45, 1.3);
    let n = 0;
    for (const s of S) {
      if (s.kind === 'lid') { const p = mid(s.pts, 0.2, 0.8); stroke(g, p, Math.max(1.25, 2.1 * sc)); n++; }        // the eye: a short dark dash (lid and iris read as one)
      else if (s.kind === 'brow') { const p = mid(s.pts, 0.15, 0.85); g.globalAlpha = 0.8; stroke(g, p, Math.max(0.9, 1.3 * sc)); g.globalAlpha = 1; n++; }
      else if (s.kind === 'mouth') { const p = mid(s.pts, 0.22, 0.78); g.globalAlpha = 0.85; stroke(g, p, Math.max(0.9, 1.3 * sc)); g.globalAlpha = 1; n++; }
    }
    if (nose) { const ctr = s => { const p = s.pts[Math.floor(s.pts.length / 2)]; return p; }, lids = S.filter(s => s.kind === 'lid'), mo = S.find(s => s.kind === 'mouth');
      if (lids.length && mo) { const e = lids.map(ctr).reduce((a, b) => [a[0] + b[0] / lids.length, a[1] + b[1] / lids.length], [0, 0]), m = ctr(mo), d = Math.hypot(e[0] - m[0], e[1] - m[1]);
        const t = [m[0] + (e[0] - m[0]) * 0.36, m[1] + (e[1] - m[1]) * 0.36], sd = nose;
        g.globalAlpha = 0.75; stroke(g, [[t[0] + sd * 0.1 * d, t[1] - 0.32 * d], [t[0] + sd * 0.12 * d, t[1] - 0.02 * d], [t[0] - sd * 0.04 * d, t[1] + 0.04 * d]], Math.max(0.9, 1.1 * sc)); g.globalAlpha = 1; n++; } }
    out.push({ px: tier.px, mode: 'feed', n });
  }
  g.restore();
  return out;
}
