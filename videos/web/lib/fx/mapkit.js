// MAPKIT: a cartographer's hierarchy for print-style maps (STUDIO CIV ASSETS c1, 1 Oct). Works with the d3-geo paths
// the scenes already build (geoPath(projection, ctx) or Path2D from P2()).
//
// CIVILIZATION's maps printed sea, host countries and sky in the same grey screen and set labels from two systems that
// collided (DETROIT and CLEVELAND twice, 17-px Plex at phone size). The fixes are design decisions, so this kit only
// makes them cheap:
//   placeLabels  ONE label system per map: dedupe by name, priority order, 8 candidate positions around each point,
//                no collisions with each other, with `avoid` rects (the type block, a card) or the frame edge; reports
//                what it dropped. A size floor (minPx) warns when a label is too small to read on a phone.
//   drawLabels   draws them with a paper halo (a knock-out under the letters, not a glow) and the point marks.
//   landSea      land and sea as different inks or tints: one call that fills land flat and rules the sea (or reverse).
//   graticule    a thin, sparse graticule that stops at the coast (lines over land are noise at phone size).
// Harrison's 1944 globes are the model: land and sea always in different values, relief drawn, few labels set with care.
import { W, H } from '../kit.js';
import { lineTint } from './printkit.js';

const norm = s => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
// items: [{ name, x, y, pri = 0, size, mark = true }]. Returns { placed: [{ name, x, y, tx, ty, align, rect, size }], dropped: [...] }
export function placeLabels(g, items, { font = (s) => `700 ${s}px "Oswald"`, size = 30, minPx = 26, pad = 6, gap = 10,
  bounds = [28, 28, W - 28, H - 28], avoid = [], upper = true, markR = 6 } = {}) {
  const best = new Map();
  for (const it of items) { const k = norm(it.name); const o = best.get(k); if (!o || (it.pri || 0) > (o.pri || 0)) best.set(k, it); }
  const list = [...best.values()].sort((a, b) => (b.pri || 0) - (a.pri || 0));
  const taken = [...avoid], placed = [], dropped = [];
  for (const it of list) { if (it.mark !== false) taken.push([it.x - markR, it.y - markR, it.x + markR, it.y + markR]); }
  for (const it of list) {
    const s = it.size || size; if (s < minPx && !placeLabels._warned) { placeLabels._warned = true; console.warn(`mapkit: ${s}px labels are below the ${minPx}px phone floor`); }
    g.save(); g.font = font(s); const txt = upper ? String(it.name).toUpperCase() : it.name, tw = g.measureText(txt).width; g.restore();
    const th = s * 0.78, d = (it.mark === false ? 0 : markR) + gap;
    const cand = [[d, 0, 'left', 0.38], [-d, 0, 'right', 0.38], [0, -d, 'center', 0], [0, d, 'center', 1], [d * 0.8, -d * 0.8, 'left', 0], [-d * 0.8, -d * 0.8, 'right', 0], [d * 0.8, d * 0.8, 'left', 1], [-d * 0.8, d * 0.8, 'right', 1]];
    let ok = null;
    for (const [dx, dy, al, vy] of cand) {
      const tx = it.x + dx, ty = it.y + dy + th * vy, x0 = al === 'left' ? tx : al === 'right' ? tx - tw : tx - tw / 2;
      const r = [x0 - pad, ty - th - pad, x0 + tw + pad, ty + pad];
      if (r[0] < bounds[0] || r[1] < bounds[1] || r[2] > bounds[2] || r[3] > bounds[3]) continue;
      if (taken.some(q => hit(q, r) && !(q[0] === it.x - markR && q[1] === it.y - markR))) continue;
      ok = { ...it, name: txt, tx, ty, align: al, rect: r, size: s }; break;
    }
    if (ok) { placed.push(ok); taken.push(ok.rect); } else dropped.push(it.name);
  }
  return { placed, dropped };
}
// draw placed labels into g (fillStyle = ink). halo: a context to knock the paper into (e.g. a plates knock via
// P.knock, or a paper-coloured ctx), or a CSS colour stroked under the text in g itself.
export function drawLabels(g, placed, { font = (s) => `700 ${s}px "Oswald"`, ink = null, halo = null, haloW = 7, mark = 'dot', markR = 6, knock = null } = {}) {
  for (const L of placed) {
    g.save(); g.font = font(L.size); g.textAlign = L.align; g.textBaseline = 'alphabetic';
    if (knock) { const p = new Path2D(); p.rect(L.rect[0] + 2, L.rect[1] + 2, L.rect[2] - L.rect[0] - 4, L.rect[3] - L.rect[1] - 4); knock(p); }
    if (halo && typeof halo === 'string') { g.lineJoin = 'round'; g.strokeStyle = halo; g.lineWidth = haloW; g.strokeText(L.name, L.tx, L.ty); }
    if (ink) g.fillStyle = ink; g.fillText(L.name, L.tx, L.ty);
    if (mark && L.mark !== false) { g.beginPath(); if (mark === 'dot') g.arc(L.x, L.y, markR * 0.75, 0, Math.PI * 2); else g.rect(L.x - markR * 0.7, L.y - markR * 0.7, markR * 1.4, markR * 1.4); g.fill(); }
    g.restore();
  }
}
// land flat, sea ruled (or swapped): land/sea are Path2D (sea may be null = everything not land, inside `frame`)
export function landSea(gLand, gSea, land, { sea = null, landStyle = null, seaStyle = null, pitch = 10, angle = 0, weight = 0.3, frame = null } = {}) {
  if (gLand && landStyle) { gLand.save(); gLand.fillStyle = landStyle; gLand.fill(land); gLand.restore(); }
  if (gSea) { let p = sea; if (!p) { p = new Path2D(); const f = frame || [0, 0, W, H]; p.rect(f[0], f[1], f[2] - f[0], f[3] - f[1]); p.addPath(land); }
    lineTint(gSea, p, { pitch, angle, weight, style: seaStyle, rule: sea ? 'nonzero' : 'evenodd' }); }
}
