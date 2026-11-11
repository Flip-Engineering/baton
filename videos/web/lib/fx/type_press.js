// TYPE PRESS (TYPE studio, cycle 2): the press is the cut. Every print process here is a two-state machine keyed to
// ONE measured onset (`hit`, song seconds): a before-state that is on screen long enough to be read as an object
// (>= 6 frames), a state change ON the onset frame, and an after-state that carries the word. The word is never a
// caption laid over a picture: it is the plate, the forme, the drum pass or the dent.
//
//   intaglioPull  BANK      burin cuts the word REVERSED in a steel plate, ink, wipe; on the hit the damp sheet swings
//                           up off the plate and reads forward (ink in relief, plate mark embossed round it)
//   platenPress   1776      a mirror forme of wood type in the chase, rollers ink it, the platen closes (dark, 2 f
//                           dwell); on the hit it opens on the sheet with the impression, reading forward
//   risoPass      CIV       a blank sheet feeds under the drum; drum 1 (red) prints ON the hit, drum 2 (black) lands one
//                           frame later off register; the next sheet slides over to clear (the clear is a sheet)
//   letterPunch   RED WEDGE one letter punch per hammer hit into a steel plate: a height field sinks the die and raises
//                           a volume-matched burr; lit only by the rake (no contour stroke anywhere)
//   daterStamp    BANK payoff  a round teller's dater struck across the note: ring legend, date band, MONEY. at >= 300 px
//   broadside     1776 payoff  a Dunlap-style sheet pulled overnight, hung on the line, SECOND / INDEPENDENCE. in wood type
//
// Everything is deterministic in t (stills, --from renders). Heavy work (height fields, sheets) bakes once per recipe.
// Each recipe returns { draw(ctx, t), info(t) }: info(t) says which state is on screen, whether the word reads, and
// the typeAudit entry, so a lab can print the sync card without guessing.
import { W, H, clamp, lerp, ease, rng } from '../kit.js';
import { canvas2d, innerShadow } from './type.js';
import { setBlock, blockCentre, steelPlate, engraved } from './type_world.js';
import { paperStock } from './type_sets.js';

const FPS = 30;
const fr = a => Math.floor(a * FPS + 1e-6);          // frame index relative to the hit (0 = the hit frame)

// ================================================================ fields: exact Euclidean distance + height relight
// Felzenszwalb & Huttenlocher's 1-D squared-distance transform, run on rows then columns.
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
// edt(feature, w, h) -> Float32Array: distance (px) from each pixel to the nearest pixel where feature[i] is true
export function edt(feature, w, h) {
  const INF = 1e20, g = new Float32Array(w * h), n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < w * h; i++) g[i] = feature[i] ? 0 : INF;
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]); }
  return g;
}
// glyph coverage of a path set in a w x h box whose top-left is (x0, y0) in frame coords
function coverage(draw, x0, y0, w, h) {
  const L = canvas2d(w, h); L.g.translate(-x0, -y0); L.g.fillStyle = '#fff'; draw(L.g);
  const d = L.g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h), a = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { a[i] = d[i * 4 + 3] / 255; m[i] = d[i * 4 + 3] > 127 ? 1 : 0; }
  return { m, a };
}
// signed distance: < 0 inside, > 0 outside (px)
export function signedDistance(mask, w, h) {
  const inv = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
  const dOut = edt(mask, w, h), dIn = edt(inv, w, h), s = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) s[i] = mask[i] ? -dIn[i] + 0.5 : dOut[i] - 0.5;
  return s;
}
// relight(hf, w, h, albedo RGBA, o) -> ImageData. The flat plate keeps its own pixels exactly (the shading is a ratio to
// the flat-normal shading), so a relit patch drops into the plate with no seam. L: toward the light, y down.
export function relight(hf, w, h, albedo, { L = [-0.62, -0.5, 0.6], amb = 0.32, kd = 0.95, spec = 0.55, shin = 36, occl = null, tint = null, shadow = false, alpha = null } = {}) {
  const ll = Math.hypot(...L), lx = L[0] / ll, ly = L[1] / ll, lz = L[2] / ll;
  let hx = lx, hy = ly, hz = lz + 1; const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
  const flat = amb + kd * lz, sflat = spec * Math.pow(hz, shin);
  const out = new ImageData(w, h), o = out.data;
  let hmax = -1e9; if (shadow) for (let i = 0; i < w * h; i++) if (hf[i] > hmax) hmax = hf[i];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, xl = x > 0 ? i - 1 : i, xr = x < w - 1 ? i + 1 : i, yu = y > 0 ? i - w : i, yd = y < h - 1 ? i + w : i;
    let nx = -(hf[xr] - hf[xl]) * 0.5, ny = -(hf[yd] - hf[yu]) * 0.5, nz = 1; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const nd = Math.max(0, nx * lx + ny * ly + nz * lz), nh = Math.max(0, nx * hx + ny * hy + nz * hz);
    let sh = 1;
    if (shadow) {                                           // march toward the light over the field: the rim shades the well
      const lxy = Math.hypot(lx, ly), dx = lx / lxy, dy = ly / lxy, rise = lz / lxy; const h0 = hf[i];
      for (let q = 1; q < 48 && h0 + q * rise < hmax; q++) { const X = Math.round(x + dx * q), Y = Math.round(y + dy * q); if (X < 0 || Y < 0 || X >= w || Y >= h) break;
        const hq = hf[Y * w + X] - (h0 + q * rise); if (hq > 0) { sh = Math.max(0.25, 1 - hq * 0.6); if (sh <= 0.25) break; } }
    }
    let k = (amb + kd * nd * sh) / flat; const s = (spec * Math.pow(nh, shin) * sh - sflat) * 255;
    if (occl) k *= occl[i];
    let r = albedo[i * 4] * k + s, g = albedo[i * 4 + 1] * k + s, b = albedo[i * 4 + 2] * k + s;
    if (tint && tint[i * 4 + 3]) { const a = tint[i * 4 + 3] / 255; r = lerp(r, r * tint[i * 4] / 255, a); g = lerp(g, g * tint[i * 4 + 1] / 255, a); b = lerp(b, b * tint[i * 4 + 2] / 255, a); }
    o[i * 4] = r; o[i * 4 + 1] = g; o[i * 4 + 2] = b; o[i * 4 + 3] = alpha ? alpha[i] * 255 : 255;
  }
  return out;
}
const put = (id) => { const L = canvas2d(id.width, id.height); L.g.putImageData(id, 0, 0); return L.cv; };
function mirrorAbout(ctx, cx) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
const eachGlyph = (g, block, fn) => { for (const G of block.glyphs) { g.save(); g.translate(G.ox, G.oy); fn(G); g.restore(); } };
function woodBench({ w = W, h = H, seed = 5, base = [58, 40, 28] } = {}) {
  const L = canvas2d(w, h), g = L.g, r = rng(seed); g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, w, h);
  for (let k = 0; k < 900; k++) { const y = r() * h, a = 0.05 + r() * 0.12; g.strokeStyle = `rgba(${r() < 0.5 ? '0,0,0' : '160,120,80'},${a})`; g.lineWidth = 0.6 + r() * 3;
    g.beginPath(); const ph = r() * 6, amp = 2 + r() * 8; for (let x = -10; x <= w + 10; x += 30) { const Y = y + Math.sin(x * 0.004 + ph) * amp; x < 0 ? g.moveTo(x, Y) : g.lineTo(x, Y); } g.stroke(); }
  g.getImageData(0, 0, 1, 1); return L.cv;
}
// a work lamp pool: the scene's one key, off-centre (multiply falloff), baked
function lampPool({ x = W * 0.3, y = H * 0.25, r0 = 300, r1 = 1500, dark = 0.72, color = '8,6,5' } = {}) {
  const L = canvas2d(), g = L.g, gr = g.createRadialGradient(x, y, r0, x, y, r1);
  gr.addColorStop(0, `rgba(${color},0)`); gr.addColorStop(1, `rgba(${color},${dark})`); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.getImageData(0, 0, 1, 1); return L.cv;
}

// ================================================================ 1. intaglio pull (BANK)
// o: font, text, cap, hit. Timeline (a = t - hit): cut [-1.9, -0.95) · ink [-0.95, -0.62) · wipe [-0.62, -0.36) ·
// hold the inked reversed plate [-0.36, 0) (11 f) · on the hit the sheet swings up and lands (frames 0-2), then settles.
export function intaglioPull({ font, text = 'MONEY.', cap = 250, hit = 0, y = 860, ink = '#0c0a0b', paper = [236, 228, 208], seed = 3, legends = null } = {}) {
  const block = setBlock(font, [{ text, cap }], { role: 'payoff', x: 540, y, maxW: 860 });
  // the plate's standing engraving (cut before this shot): double border, lathe rosettes, micro legends. On the plate it
  // is mirrored like the word; on the sheet it reads forward. Legends stay at micro size (sub-legible at feed size).
  const LEG = (legends || [['THE PEOPLE\'S NATIONAL BANK', 40, 470], ['BACKED BY THE PRODUCTION OF THE NATION', 26, 1330]]).map(([tx, c, yy]) => setBlock(font, [{ text: tx, cap: c, tracking: 0.05 }], { role: 'micro', x: 540, y: yy, maxW: 780 }));
  const ornament = (g, col, lw = 1) => {
    g.save(); g.strokeStyle = col; g.fillStyle = col;
    g.lineWidth = 5 * lw; g.strokeRect(118, 378, 844, 1044); g.lineWidth = 1.6 * lw; g.strokeRect(132, 392, 816, 1016);
    for (let k = 0; k < 9; k++) { g.lineWidth = 0.9 * lw; g.beginPath(); for (let x = 140; x <= 940; x += 4) { const yy = 408 + k * 3 + Math.sin(x * 0.06 + k * 0.7) * 5; x === 140 ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke();
      g.beginPath(); for (let x = 140; x <= 940; x += 4) { const yy = 1370 + k * 3 + Math.sin(x * 0.06 + k * 0.7) * 5; x === 140 ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke(); }
    for (const [ox, oy, R, r0, k1] of [[540, 1150, 150, 70, 18], [215, 1210, 70, 30, 12], [865, 1210, 70, 30, 12], [540, 620, 95, 40, 16]]) for (let j = 0; j < 6; j++) {
      g.lineWidth = 0.7 * lw; g.beginPath(); const ph = j / 6 * Math.PI;
      for (let i = 0; i <= 360; i++) { const a = i / 360 * Math.PI * 2, rr = r0 + (R - r0) * (0.5 + 0.5 * Math.sin(a * k1 + ph)); const X = ox + Math.cos(a) * rr, Y = oy + Math.sin(a) * rr; i ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.stroke(); }
    for (const B of LEG) eachGlyph(g, B, G => g.fill(G.path));
    g.restore();
  };
  const [cx] = blockCentre(block);
  const PL = { x: 70, y: 330, w: 940, h: 1140 };             // the plate on the bench
  const bench = woodBench({ seed }), pool = lampPool({ x: W * 0.28, y: H * 0.22, r0: 250, r1: 1600, dark: 0.78 });
  const steel = steelPlate({ w: PL.w, h: PL.h, seed: seed + 4, tone: 150, rust: 0.05, light: [0.1, 0.05] });
  // groove geometry, reversed: a mirrored copy of the block's paths in frame coords
  const ruledSprite = (lw0, col, alpha, lip) => {        // rulings inside the (mirrored) letters, as grooves
    const L = canvas2d(); const g = L.g; mirrorAbout(g, cx);
    eachGlyph(g, block, G => { const p = Math.max(4, G.cap / 24), b = G.bb; g.save(); g.clip(G.path);
      for (let yy = b.y1 + p * 0.5; yy < b.y2 + p; yy += p) { const u = clamp((yy - b.y1) / b.h); g.lineWidth = p * lerp(lw0, 0.9, u * u);
        if (lip) { g.strokeStyle = 'rgba(255,252,240,0.55)'; g.beginPath(); g.moveTo(b.x1 - 2, yy - g.lineWidth * 0.5 - 0.8); g.lineTo(b.x2 + 2, yy - g.lineWidth * 0.5 - 0.8); g.lineWidth = 1; g.stroke(); g.lineWidth = p * lerp(lw0, 0.9, u * u); }
        g.strokeStyle = col; g.globalAlpha = alpha; g.beginPath(); g.moveTo(b.x1 - 2, yy); g.lineTo(b.x2 + 2, yy); g.stroke(); g.globalAlpha = 1; }
      g.restore(); });
    g.getImageData(0, 0, 1, 1); return L.cv;
  };
  const shallow = ruledSprite(0.18, 'rgba(30,32,38,1)', 0.55, true);   // the rulings cut earlier, clean steel: faint grooves with a lit lip
  const inked = ruledSprite(0.5, ink, 1, false);
  for (const [cv, col, lip] of [[shallow, 'rgba(28,30,36,0.7)', true], [inked, ink, false]]) { const g = cv.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); mirrorAbout(g, cx);
    if (lip) { g.save(); g.translate(-1, -1); ornament(g, 'rgba(255,252,240,0.35)'); g.restore(); } ornament(g, col); g.restore(); }
  // the print (forward): ink stands in relief on damp paper, plate mark embossed round the plate area
  const ENG = engraved({ ink, paper: `rgb(${paper})`, pitch: 24, weight: [0.5, 0.95], margin: 0 });
  const sheet = (() => {
    const P = paperStock({ w: W, h: H, seed: seed + 9, base: paper, tooth: 9, fibres: 1400, burn: 0.12 });
    const L = canvas2d(), g = L.g; g.drawImage(P, 0, 0);
    // plate mark: the plate was pressed into the sheet: a bevelled step round the plate rectangle
    const pm = { x: PL.x + 20, y: PL.y + 20, w: PL.w - 40, h: PL.h - 40 };
    g.fillStyle = 'rgba(0,0,0,0.035)'; g.fillRect(pm.x, pm.y, pm.w, pm.h);
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,250,0.7)'; g.strokeRect(pm.x - 2, pm.y - 2, pm.w, pm.h);
    g.lineWidth = 2; g.strokeStyle = 'rgba(80,60,40,0.35)'; g.strokeRect(pm.x + 1.5, pm.y + 1.5, pm.w, pm.h);
    ornament(g, 'rgba(24,20,20,0.9)');
    ENG.draw(g, block, 1, { clearAlpha: 0, light: 0.4 });
    // relief: the ink sits proud, so a hair of shadow falls down-right of every stroke (not a drop shadow: 1-2 px, ink-coloured)
    g.getImageData(0, 0, 1, 1); return L.cv;
  })();
  // main strokes for the burin: every contour of every mirrored glyph, in cut order (glyph by glyph, right to left on the plate)
  const strokes = []; for (const G of block.glyphs) for (const c of G.contours) strokes.push({ G, c });
  const totalLen = strokes.reduce((s, k) => s + k.c.len, 0);
  const T = { cut0: -1.9, ink0: -0.95, wipe0: -0.62, hold0: -0.36 };
  const mx = x => 2 * cx - x;                                  // mirror x in frame coords
  const drawBurin = (ctx, x, y, dir) => {                      // lozenge-section steel with a mushroom handle, pushed away from the hand
    ctx.save(); ctx.translate(x, y); ctx.rotate(dir);
    const g1 = ctx.createLinearGradient(0, -9, 0, 9); g1.addColorStop(0, '#e9eef2'); g1.addColorStop(0.45, '#8c949c'); g1.addColorStop(1, '#2a2e33');
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.moveTo(6, 10); ctx.lineTo(-420, 60); ctx.lineTo(-560, 90); ctx.lineTo(-560, 150); ctx.lineTo(-420, 80); ctx.closePath(); ctx.fill();   // its shadow on the plate
    ctx.fillStyle = g1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-40, -12); ctx.lineTo(-430, -15); ctx.lineTo(-430, 15); ctx.lineTo(-40, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(-420, -12, 380, 3);
    const g2 = ctx.createRadialGradient(-500, -40, 10, -520, 0, 130); g2.addColorStop(0, '#b98252'); g2.addColorStop(0.7, '#5a3218'); g2.addColorStop(1, '#2a150a');
    ctx.fillStyle = g2; ctx.beginPath(); ctx.ellipse(-530, 0, 115, 88, 0, 0, 7); ctx.fill();
    ctx.restore();
    // the chip curling up off the tip: a bright spiral of steel
    ctx.save(); ctx.strokeStyle = 'rgba(245,248,252,0.95)'; ctx.lineWidth = 2.2; ctx.beginPath();
    for (let k = 0; k <= 24; k++) { const a = k / 24 * 5.5, r = 3 + k * 0.7; const px = x + Math.cos(dir + a) * r + Math.cos(dir) * 4, py = y + Math.sin(dir + a) * r + Math.sin(dir) * 4 - k * 0.4; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke(); ctx.restore();
  };
  const R = {
    block, hit,
    state(t) { const a = t - hit; return a < T.ink0 ? 'cut' : a < T.wipe0 ? 'ink' : a < T.hold0 ? 'wipe' : a < 0 ? 'plate' : 'print'; },
    draw(ctx, t) {
      const a = t - hit, f = fr(a);
      if (f >= 0) {                                            // the pull: the sheet swings up from the bottom edge toward camera
        ctx.drawImage(bench, 0, 0); ctx.drawImage(steel, PL.x, PL.y);
        const u = f >= 3 ? 1 : [0.84, 0.96, 0.995][f];               // most of the change lands ON the hit frame
        const s = f < 3 ? 1.04 : lerp(1.04, 1, ease.outCubic((a - 0.1) / 0.3));
        const topY = lerp(H, 0, u), n = 48;
        for (let k = 0; k < n; k++) {                           // perspective slices: the free edge is nearer the camera (wider)
          const v0 = k / n, v1 = (k + 1) / n, y0 = lerp(topY, H, v0), y1 = lerp(topY, H, v1) + 1;
          const wid = W * s * lerp(1 + 0.22 * (1 - u), 1, v0), x0 = W / 2 - wid / 2;
          ctx.drawImage(sheet, 0, v0 * H, W, (v1 - v0) * H, x0, y0, wid, y1 - y0);
        }
        if (u < 1) { ctx.fillStyle = `rgba(20,14,10,${0.35 * (1 - u)})`; ctx.fillRect(0, topY, W, H - topY); }   // the underside still turning into the light
        ctx.drawImage(pool, 0, 0);
        return;
      }
      ctx.drawImage(bench, 0, 0); ctx.drawImage(steel, PL.x, PL.y);
      // bevel of the plate edge
      ctx.strokeStyle = 'rgba(255,250,240,0.35)'; ctx.lineWidth = 3; ctx.strokeRect(PL.x + 1.5, PL.y + 1.5, PL.w - 3, PL.h - 3);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(PL.x + 6, PL.y + PL.h, PL.w, 10); ctx.fillRect(PL.x + PL.w, PL.y + 6, 10, PL.h);
      ctx.save(); ctx.beginPath(); ctx.rect(PL.x, PL.y, PL.w, PL.h); ctx.clip();
      { const sp = ctx.createLinearGradient(PL.x, PL.y, PL.x + PL.w, PL.y + PL.h); sp.addColorStop(0.18, 'rgba(255,246,230,0)'); sp.addColorStop(0.3, 'rgba(255,246,230,0.22)'); sp.addColorStop(0.42, 'rgba(255,246,230,0)');
        ctx.fillStyle = sp; ctx.fillRect(PL.x, PL.y, PL.w, PL.h); }
      const cutU = clamp((a - T.cut0) / (T.ink0 - T.cut0 - 0.08));
      if (a < T.ink0) {
        ctx.drawImage(shallow, 0, 0);
        // the burin line: contours grooved up to the cut length
        let L = cutU * totalLen, tip = null;
        ctx.save(); mirrorAbout(ctx, cx); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const { G, c } of strokes) {
          if (L <= 0) break; const p = Math.min(L, c.len); L -= c.len;
          ctx.save(); ctx.translate(G.ox, G.oy);
          const path = () => { ctx.beginPath(); ctx.moveTo(c.pts[0], c.pts[1]); let j = 1; for (; j < c.cum.length && c.cum[j] <= p; j++) ctx.lineTo(c.pts[2 * j], c.pts[2 * j + 1]); return j; };
          ctx.strokeStyle = 'rgba(250,252,255,0.8)'; ctx.lineWidth = 2; ctx.translate(-1.2, -1.2); path(); ctx.stroke(); ctx.translate(1.2, 1.2);
          ctx.strokeStyle = '#15171b'; ctx.lineWidth = Math.max(2.4, G.cap / 80); const j = path(); ctx.stroke();
          if (p < c.len) { const k = Math.min(j, c.cum.length - 1); tip = { x: G.ox + c.pts[2 * k - 2], y: G.oy + c.pts[2 * k - 1], dx: c.pts[2 * k] - c.pts[2 * k - 2], dy: c.pts[2 * k + 1] - c.pts[2 * k - 1] }; }
          ctx.restore();
        }
        ctx.restore();
        ctx.restore();
        if (tip) { const X = mx(tip.x); drawBurin(ctx, X, tip.y, Math.atan2(-0.58, -0.81)); }
        ctx.drawImage(pool, 0, 0); return;
      }
      // inked: grooves hold ink (black rulings + outline); the surface is covered, then wiped
      ctx.drawImage(inked, 0, 0);
      ctx.save(); mirrorAbout(ctx, cx); eachGlyph(ctx, block, G => { ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2.4, G.cap / 80); ctx.strokeStyle = ink; ctx.stroke(G.path); }); ctx.restore();
      if (a < T.wipe0) {                                       // the dabber lays ink over the plate: a sweep left to right
        const u = ease.inOutCubic((a - T.ink0) / (T.wipe0 - T.ink0)), xw = lerp(PL.x - 100, PL.x + PL.w + 100, u);
        ctx.fillStyle = 'rgba(12,10,11,0.93)'; ctx.fillRect(PL.x, PL.y, xw - PL.x, PL.h);
        const gr = ctx.createLinearGradient(xw - 90, 0, xw, 0); gr.addColorStop(0, 'rgba(12,10,11,0.93)'); gr.addColorStop(1, 'rgba(12,10,11,0)'); ctx.fillStyle = gr; ctx.fillRect(xw - 90, PL.y, 90, PL.h);
      } else if (a < T.hold0) {                                // the tarlatan wipe: diagonal strokes take the ink off the face
        const u = ease.inOutCubic((a - T.wipe0) / (T.hold0 - T.wipe0));
        ctx.save(); ctx.beginPath(); const e = lerp(-900, W + 1500, u);
        ctx.moveTo(e, PL.y); ctx.lineTo(W + 2000, PL.y); ctx.lineTo(W + 2000, H); ctx.lineTo(e - 700, H); ctx.closePath(); ctx.clip();
        ctx.fillStyle = 'rgba(12,10,11,0.93)'; ctx.fillRect(PL.x, PL.y, PL.w, PL.h); ctx.restore();
        const r = rng(seed + 31); ctx.strokeStyle = 'rgba(12,10,11,0.18)';
        for (let k = 0; k < 40; k++) { const o = r() * 400; ctx.lineWidth = 2 + r() * 10; ctx.beginPath(); ctx.moveTo(e0(e, o) , PL.y); ctx.lineTo(e0(e, o) - 700, H); ctx.stroke(); }
      } else {                                                 // plate tone: the hand wipe leaves a faint film, darker at the margins
        const gr = ctx.createRadialGradient(W / 2, 900, 200, W / 2, 900, 800); gr.addColorStop(0, 'rgba(12,10,11,0.05)'); gr.addColorStop(1, 'rgba(12,10,11,0.3)');
        ctx.fillStyle = gr; ctx.fillRect(PL.x, PL.y, PL.w, PL.h);
      }
      ctx.restore();
      ctx.drawImage(pool, 0, 0);
    },
    info(t) { const s = R.state(t), a = t - hit; return { state: s, reversed: s !== 'print', reads: s === 'print' && fr(a) >= 1 ? 1 : 0, frame: fr(a) }; },
  };
  function e0(e, o) { return e - o; }
  return R;
}

// ================================================================ 2. platen press (1776)
// The camera is the forme: we look down on the chase (type reversed), the rollers ink it, the platen swings shut over
// us (the frame goes dark, 2 frames of dwell), and on the hit it falls open with the sheet on it, reading forward.
export function platenPress({ faces, lines = null, hit = 0, seed = 12, paper = [238, 230, 210], ink = '#141011', sheetOf = null, sx = 40, sy = 180 } = {}) {
  // sheetOf: a broadside(): this pull is its SECOND pass. The forme holds only the red line (reversed, red-inked); the
  // platen takes the sheet already printed black and opens on the finished sheet. Without it: one black pass of `lines`.
  let block;
  if (sheetOf) { const b2 = sheetOf.blocks.l2, [ox, oy] = sheetOf.redOffset; block = { ...b2, glyphs: b2.glyphs.map(G => ({ ...G, ox: G.ox + sx + ox, oy: G.oy + sy + oy })),
    bbox: { x1: b2.bbox.x1 + sx, x2: b2.bbox.x2 + sx, y1: b2.bbox.y1 + sy, y2: b2.bbox.y2 + sy } }; ink = sheetOf.red; }
  else { const LINES = lines || [{ text: 'SECOND', font: faces.wood, cap: 230 }, { text: 'INDEPENDENCE.', font: faces.cond, fill: true, max: 300 }];
    block = setBlock(LINES[0].font, LINES, { role: 'payoff', x: 540, y: 760, gap: 0.22, maxW: 900 }); }
  const cx = sheetOf ? sx + sheetOf.w / 2 : 540;
  const r = rng(seed);
  // --- the forme (reversed): wood type blocks (pale end grain), the glyph faces inked, packed with dark furniture in an iron chase
  const forme = (() => {
    const L = canvas2d(), g = L.g;
    g.fillStyle = '#1b1a19'; g.fillRect(0, 0, W, H);                                         // the bed
    const b = block.bbox, ch = { x: 30, y: b.y1 - 330, w: 1020, h: b.y2 - b.y1 + 660 };
    g.fillStyle = '#3a3835'; g.fillRect(ch.x, ch.y, ch.w, ch.h); g.fillStyle = '#0f0e0d'; g.fillRect(ch.x + 30, ch.y + 30, ch.w - 60, ch.h - 60);   // iron chase
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(ch.x, ch.y, ch.w, 3);
    // furniture: full-width reglets of walnut, a lead between, one or two joins each (a packed forme, not brickwork)
    for (let yy = ch.y + 36; yy < ch.y + ch.h - 40; yy += 62) { if (yy > b.y1 - 70 && yy < b.y2 + 40) continue;
      const x0 = ch.x + 36, x1 = ch.x + ch.w - 36, j = x0 + (0.25 + r() * 0.5) * (x1 - x0), tone = 62 + r() * 18;
      g.fillStyle = `rgb(${tone},${tone * 0.7 | 0},${tone * 0.45 | 0})`; g.fillRect(x0, yy, j - x0 - 2, 52); g.fillRect(j + 2, yy, x1 - j - 2, 52);
      g.fillStyle = 'rgba(255,230,190,0.07)'; g.fillRect(x0, yy, x1 - x0, 2); g.fillStyle = '#4c4f53'; g.fillRect(x0, yy + 53, x1 - x0, 7); }
    for (const qx of [300, 700]) { g.fillStyle = '#707275'; g.fillRect(qx, ch.y + ch.h - 80, 110, 34); g.fillStyle = '#26272a'; g.beginPath(); g.arc(qx + 55, ch.y + ch.h - 63, 8, 0, 7); g.fill(); }
    g.save(); mirrorAbout(g, cx);
    for (const G of block.glyphs) {
      const gb = G.bb, pad = G.cap * 0.05, bx = G.ox + gb.x1 - pad, by = G.oy - G.cap * 0.6, bw = gb.w + 2 * pad, bh = G.cap * 1.2;
      const tone = 196 + r() * 26; g.fillStyle = `rgb(${tone},${tone * 0.82 | 0},${tone * 0.6 | 0})`; g.fillRect(bx, by, bw, bh);
      g.save(); g.beginPath(); g.rect(bx, by, bw, bh); g.clip(); g.strokeStyle = 'rgba(120,80,40,0.28)';
      for (let k = 0; k < 10; k++) { g.lineWidth = 1 + r() * 1.5; g.beginPath(); g.ellipse(bx + bw * r(), by + bh * (0.5 + r()), bw * (0.3 + r()), bh * (0.3 + r() * 0.5), 0, 0, 7); g.stroke(); }
      g.restore();
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 3; g.strokeRect(bx, by, bw, bh);
      g.save(); g.translate(G.ox, G.oy); g.fillStyle = ink; g.fill(G.path); g.restore();              // the inked face
    }
    g.restore(); g.getImageData(0, 0, 1, 1); return L.cv;
  })();
  // gloss on the inked faces: fresh ink shines where the roller just passed (a moving spec band clipped to the glyphs)
  const glossMask = (() => { const L = canvas2d(), g = L.g; mirrorAbout(g, cx); g.fillStyle = '#fff'; eachGlyph(g, block, G => g.fill(G.path)); g.getImageData(0, 0, 1, 1); return L.cv; })();
  // --- the printed sheet on the platen (forward): impression with deboss, salt, squeezed rim
  const onPlaten = (art) => { const L = canvas2d(), g = L.g; g.fillStyle = '#16140f'; g.fillRect(0, 0, W, H); g.fillStyle = '#2b2925'; g.fillRect(sx - 20, sy - 30, (art ? art.width : 980) + 40, (art ? art.height : 1260) + 60);
    if (art) g.drawImage(art, sx, sy); g.fillStyle = '#9a8f78'; for (const [x, y] of [[sx + 140, sy + (art ? art.height : 1260) - 8], [sx + 720, sy + (art ? art.height : 1260) - 8], [sx - 8, sy + 330]]) g.fillRect(x, y, 46, 16);
    g.getImageData(0, 0, 1, 1); return L.cv; };
  const sheet = sheetOf ? onPlaten(sheetOf.sheet) : (() => {
    const L = canvas2d(), g = L.g; g.fillStyle = '#16140f'; g.fillRect(0, 0, W, H);              // the platen iron round the sheet
    g.fillStyle = '#2b2925'; g.fillRect(20, 150, W - 40, 1340);
    const P = paperStock({ w: 980, h: 1260, seed: seed + 5, base: paper, tooth: 12, fibres: 1200, burn: 0.1 }); g.drawImage(P, 50, 190);
    g.fillStyle = '#9a8f78'; for (const [x, y] of [[180, 1452], [760, 1452], [42, 520]]) { g.fillRect(x, y, 46, 16); }     // gauge pins holding the sheet
    const imp = canvas2d(), q = imp.g; q.fillStyle = ink; eachGlyph(q, block, G => q.fill(G.path));
    q.save(); q.globalCompositeOperation = 'destination-out'; const rr = rng(seed + 3);
    for (let k = 0; k < 2600; k++) { q.fillStyle = `rgba(0,0,0,${0.3 + rr() * 0.7})`; q.beginPath(); q.arc(rr() * W, 250 + rr() * 1100, 0.4 + rr() * 2.2, 0, 7); q.fill(); }   // salt: starved ink
    for (let k = 0; k < 500; k++) { const yy = 250 + rr() * 1100; q.strokeStyle = `rgba(0,0,0,${0.08 + rr() * 0.2})`; q.lineWidth = 0.6 + rr() * 2; q.beginPath(); q.moveTo(0, yy); q.lineTo(W, yy + (rr() - 0.5) * 6); q.stroke(); }   // wood grain in the solids
    q.restore();
    eachGlyph(q, block, G => { q.save(); q.clip(G.path); q.lineWidth = Math.max(3, G.cap * 0.025); q.strokeStyle = ink; q.globalAlpha = 0.85; q.stroke(G.path); q.restore();   // squeeze rim
      innerShadow(q, G, 'rgba(0,0,0,0.38)', 3, 4, 3); innerShadow(q, G, 'rgba(255,248,230,0.3)', -2, -2, 2); });
    q.getImageData(0, 0, 1, 1);
    g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(imp.cv, 0, 0); g.restore();
    g.getImageData(0, 0, 1, 1); return L.cv;
  })();
  const pool = lampPool({ x: W * 0.72, y: H * 0.18, r0: 300, r1: 1500, dark: 0.7 });
  const T = { roll0: -1.25, roll1: -0.55, close0: -0.3, shut: -2 / 30 };
  const R = {
    block, hit,
    state(t) { const a = t - hit; return a < T.close0 ? 'forme' : a < T.shut - 1e-6 ? 'closing' : a < 0 ? 'shut' : 'sheet'; },
    draw(ctx, t) {
      const a = t - hit, f = fr(a);
      if (f >= 0) {                                             // open: the platen swings away, the sheet recedes into the light
        const s = f === 0 ? 1.08 : lerp(1.08, 1.0, ease.outCubic((a - 0.033) / 0.35)), lit = f === 0 ? 0.8 : 1;
        ctx.save(); ctx.fillStyle = '#0d0c0a'; ctx.fillRect(0, 0, W, H); ctx.translate(W / 2, H * 0.45); ctx.scale(s, s); ctx.translate(-W / 2, -H * 0.45);
        ctx.drawImage(sheet, 0, 0); ctx.restore();
        if (lit < 1) { ctx.fillStyle = `rgba(10,8,6,${1 - lit})`; ctx.fillRect(0, 0, W, H); }
        ctx.drawImage(pool, 0, 0); return;
      }
      { const zc = (block.bbox.y1 + block.bbox.y2) / 2, zk = 1.14; ctx.save(); ctx.translate(W / 2, zc); ctx.scale(zk, zk); ctx.translate(-cx, -zc); ctx.drawImage(forme, 0, 0); ctx.restore(); }
      // rollers: two composition rollers run down the forme and back, leaving the faces freshly inked
      if (a >= T.roll0 && a < T.roll1) {
        const u = (a - T.roll0) / (T.roll1 - T.roll0), p = u < 0.5 ? ease.inOutCubic(u * 2) : ease.inOutCubic(2 - u * 2);
        for (const k of [0, 1]) { const yy = lerp(120, 1380, p) + k * 150;
          const gr = ctx.createLinearGradient(0, yy - 60, 0, yy + 60); gr.addColorStop(0, '#0a0909'); gr.addColorStop(0.35, '#3a3638'); gr.addColorStop(0.5, '#6d6668'); gr.addColorStop(0.65, '#2a2628'); gr.addColorStop(1, '#070707');
          ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, yy + 50, W, 40); ctx.fillStyle = gr; ctx.fillRect(0, yy - 60, W, 120);
          ctx.fillStyle = '#8a8c90'; ctx.fillRect(0, yy - 14, 30, 28); ctx.fillRect(W - 30, yy - 14, 30, 28); }
      }
      // gloss band on the inked faces (the rake catching wet ink), drifting with the last roller pass
      { const gy = a < T.roll1 ? lerp(300, 1300, clamp((a - T.roll0) / (T.roll1 - T.roll0))) : 700 + 60 * Math.sin(a * 3);
        const L = glossLayer(); L.g.clearRect(0, 0, W, H); const gr = L.g.createLinearGradient(0, gy - 140, 0, gy + 140);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(200,205,215,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); L.g.fillStyle = gr; L.g.fillRect(0, 0, W, H);
        L.g.globalCompositeOperation = 'destination-in'; L.g.drawImage(glossMask, 0, 0); L.g.globalCompositeOperation = 'source-over';
        { const zc = (block.bbox.y1 + block.bbox.y2) / 2, zk = 1.14; ctx.save(); ctx.translate(W / 2, zc); ctx.scale(zk, zk); ctx.translate(-cx, -zc); ctx.drawImage(L.cv, 0, 0); ctx.restore(); } }
      ctx.drawImage(pool, 0, 0);
      if (a >= T.close0) {                                      // the platen swings up over the forme: its iron back rises, the light goes
        const u = clamp((a - T.close0) / (T.shut - T.close0)), top = lerp(H, -40, ease.inCubic(u));
        const gr = ctx.createLinearGradient(0, top, 0, top + 400); gr.addColorStop(0, '#2b2824'); gr.addColorStop(0.1, '#141210'); gr.addColorStop(1, '#070605');
        ctx.fillStyle = `rgba(4,3,2,${0.75 * u})`; ctx.fillRect(0, 0, W, H);          // the closing platen blocks the lamp
        ctx.fillStyle = gr; ctx.fillRect(0, top, W, H - top + 50);
        ctx.strokeStyle = '#3a3630'; ctx.lineWidth = 10; for (const rx of [200, 540, 880]) { ctx.beginPath(); ctx.moveTo(rx, top + 30); ctx.lineTo(rx, H); ctx.stroke(); }   // ribs
        if (a >= T.shut) { ctx.fillStyle = 'rgba(3,2,2,0.97)'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = 'rgba(255,220,170,0.06)'; ctx.fillRect(0, 0, W, 6); }   // dwell: the impression
      }
    },
    info(t) { const s = R.state(t), a = t - hit; return { state: s, reversed: s === 'forme', reads: s === 'sheet' && fr(a) >= 1 ? 1 : 0, frame: fr(a) }; },
  };
  let _gl = null; function glossLayer() { return _gl || (_gl = canvas2d()); }
  return R;
}

// ================================================================ 3. riso pass (CIVILIZATION)
// drum 1 prints ON the hit frame (most of the band on frame 0, the tail on frame 1), drum 2 lands one frame later
// registered `reg` px off and `rot` rad skewed; overlap is multiply (black over red = the third colour); the next
// sheet feeds over at `clear` s after the hit.
export function risoPass({ faces, text = ['SHIPPED', 'OUT.'], hit = 0, clear = 0.9, seed = 3, reg = [7, 5], rot = 0.005, red = '#d0262a', black = '#171516', stock = [236, 230, 214], artRed = null, artBlack = null, knockout = true } = {}) {
  // knockout (default): drum 1 prints the red field with the words left as paper (they read ON the hit frame, cream on
  // red); drum 2 lays the picture in black a frame later (black over red = the third colour). knockout false: the
  // words come on drum 2 in black.
  const block = setBlock(faces.cond, text.map(s => ({ text: s, fill: true, max: 290 })), { role: 'payoff', x: 540, y: knockout ? 590 : 820, gap: 0.08, maxW: 860 });
  const r = rng(seed);
  const texture = (g, sd) => { g.save(); g.globalCompositeOperation = 'destination-out'; const rr = rng(sd);
    for (let k = 0; k < 9000; k++) { g.fillStyle = `rgba(0,0,0,${0.2 + rr() * 0.8})`; g.beginPath(); g.arc(rr() * W, rr() * H, 0.4 + rr() * rr() * 2.4, 0, 7); g.fill(); }
    for (let y = 0; y < H; y += 3) { const a = 0.1 * (0.5 + 0.5 * Math.sin(y * 0.021 + sd) * Math.sin(y * 0.0047 + sd * 2)); if (a > 0.01) { g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(0, y, W, 2); } }
    g.restore(); };
  const glyphsInto = g => { for (const G of block.glyphs) { g.save(); g.translate(G.ox, G.oy); g.fill(G.path); g.restore(); } };
  // the ship, bow three-quarter: hull, stacked boxes, the bridge, cranes; drawn in the plate's ink
  const ship = g => { g.save(); g.translate(0, 150); g.beginPath(); g.moveTo(90, 1010); g.lineTo(990, 1010); g.lineTo(930, 1120); g.lineTo(170, 1120); g.closePath(); g.fill();
    for (let k = 0; k < 8; k++) for (let j = 0; j < 3 + (k % 3 === 1 ? 1 : 0); j++) g.fillRect(150 + k * 86, 1004 - (j + 1) * 50, 80, 46);
    g.fillRect(860, 830, 76, 176); g.fillRect(846, 816, 104, 20); g.fillRect(880, 770, 14, 50);
    g.fillRect(60, 1150, 960, 10); g.fillRect(120, 1180, 840, 6); g.fillRect(200, 1206, 680, 4); g.restore(); };
  const plateRed = (() => { const L = canvas2d(), g = L.g; g.fillStyle = red;
    if (artRed) artRed(g); else if (knockout) { g.fillRect(40, 250, W - 80, 1140); g.globalCompositeOperation = 'destination-out'; glyphsInto(g); g.globalCompositeOperation = 'source-over'; }
    else { g.fillRect(60, 1020, 960, 420); g.fillRect(60, 250, 960, 90); }
    texture(g, seed + 1); g.getImageData(0, 0, 1, 1); return L.cv; })();
  const plateBlack = (() => { const L = canvas2d(), g = L.g; g.fillStyle = black;
    if (!knockout) glyphsInto(g);
    if (artBlack) artBlack(g); else ship(g);
    texture(g, seed + 2); g.getImageData(0, 0, 1, 1); return L.cv; })();
  const newsprint = paperStock({ w: W, h: H, seed: seed + 7, base: stock, tooth: 16, fibres: 2600, burn: 0.06 });
  const machine = (() => { const L = canvas2d(), g = L.g;                                // the drum housing at the head of the frame
    const gr = g.createLinearGradient(0, 0, 0, 230); gr.addColorStop(0, '#0e0d0e'); gr.addColorStop(0.6, '#2a2728'); gr.addColorStop(0.8, '#5a1418'); gr.addColorStop(1, '#161214');
    g.fillStyle = gr; g.fillRect(0, 0, W, 230); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 230, W, 26); g.getImageData(0, 0, 1, 1); return L.cv; })();
  const tray = '#2b2a28';
  const sheetAt = (ctx, y, printed, a) => {                 // one sheet at vertical offset y (0 = resting)
    ctx.save(); ctx.translate(0, y);
    ctx.drawImage(newsprint, 40, 150, W - 80, H - 300, 40, 150, W - 80, H - 300);
    if (printed) printed(ctx);
    ctx.restore();
  };
  const drum = (ctx, P, cover, dx = 0, dy = 0, rr = 0) => {   // a drum pass: the plate laid down to `cover` (0..1 of the sheet height)
    if (cover <= 0) return; ctx.save(); ctx.beginPath(); ctx.rect(40, 150, W - 80, (H - 300) * cover); ctx.clip();
    ctx.globalCompositeOperation = 'multiply'; ctx.translate(W / 2 + dx, H / 2 + dy); ctx.rotate(rr); ctx.translate(-W / 2, -H / 2); ctx.drawImage(P, 0, 0); ctx.restore();
  };
  const R = {
    block, hit,
    state(t) { const a = t - hit, f = fr(a); return a < -0.25 ? 'feed' : f < 0 ? 'blank' : f === 0 ? 'drum1' : f === 1 ? 'drum2' : a < clear ? 'printed' : 'clear'; },
    draw(ctx, t) {
      const a = t - hit, f = fr(a);
      ctx.fillStyle = tray; ctx.fillRect(0, 0, W, H);
      const printed = c => { drum(c, plateRed, f < 0 ? 0 : f === 0 ? 0.78 : 1); drum(c, plateBlack, f < 1 ? 0 : f === 1 ? 0.8 : 1, reg[0], reg[1], rot); };
      const feedY = a < -0.25 ? lerp(-1500, 0, ease.outCubic(clamp((a + 0.75) / 0.5))) : 0;
      sheetAt(ctx, feedY, f >= 0 ? printed : null, a);
      if (a >= clear) {                                         // the next sheet slides over the last: the clear is physical
        const u = ease.inOutCubic(clamp((a - clear) / 0.16)); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(40, lerp(-1500, 0, u) + H - 150, W - 80, 30);
        sheetAt(ctx, lerp(-1570, 0, u), null, a);
      }
      ctx.drawImage(machine, 0, 0);
    },
    info(t) { const s = R.state(t); return { state: s, reads: s === 'drum2' || s === 'printed' ? 1 : 0, frame: fr(t - hit) }; },
  };
  return R;
}

// ================================================================ 4. letter punch (RED WEDGE / PRODUCTIVE)
// strikes[i]: the hammer hit for glyph i. Height field per glyph: a flat-faced die with draft sinks `depth` px, the
// displaced metal rises as a burr ring whose volume matches the dent's. Lit only by the rake: no contour, no outline.
export function letterPunch({ font, text = 'OURS', cap = 330, strikes = [], y = 800, seed = 9, depth = 9, paintAfter = null, paintInk = [184, 20, 28] } = {}) {
  const block = setBlock(font, [{ text, cap }], { role: 'slam', y, maxW: 900 });
  const plateC = steelPlate({ w: W, h: H, seed: seed, tone: 138, rust: 0.18, light: [0.12, 0.08] });
  const plate = plateC.getContext('2d').getImageData(0, 0, W, H).data;
  const r = rng(seed);
  // per glyph: region, base albedo, the struck relit patch (bake once)
  const glyphs = block.glyphs.map((G, i) => {
    const jit = { dx: (r() - 0.5) * 10, dy: (r() - 0.5) * 12, rot: (r() - 0.5) * 0.08, dep: lerp(0.8, 1.1, r()) };
    const pad = 40, b = G.bb, x0 = Math.floor(G.ox + b.x1 - pad + jit.dx), y0 = Math.floor(G.oy + b.y1 - pad + jit.dy), w = Math.ceil(b.w + 2 * pad), h = Math.ceil(b.h + 2 * pad);
    const cov = coverage(g => { g.translate(G.ox + jit.dx, G.oy + jit.dy); g.rotate(jit.rot); g.fill(G.path); }, x0, y0, w, h);
    const sd = signedDistance(cov.m, w, h);
    let area = 0, per = 0; for (let k = 0; k < w * h; k++) { if (cov.m[k]) area++; if (sd[k] > 0 && sd[k] < 1.5) per++; }
    const D = depth * jit.dep, wall = 3.2, rb = 1.6;            // die depth, draft wall (px), burr radius
    const B = Math.min(D * 0.45, area * D * 0.2 / Math.max(1, per * rb * 1.2));
    const gw = Math.ceil(w / 10) + 2, rq = rng(seed + i * 29), gn = Float32Array.from({ length: gw * (Math.ceil(h / 10) + 2) }, () => rq());   // burr irregularity: value noise, 10 px cells
    const vn = (x, y) => { const X = x / 10, Y = y / 10, i0 = X | 0, j0 = Y | 0, fx = X - i0, fy = Y - j0, a = gn[j0 * gw + i0], b = gn[j0 * gw + i0 + 1], c = gn[(j0 + 1) * gw + i0], d = gn[(j0 + 1) * gw + i0 + 1]; return lerp(lerp(a, b, fx), lerp(c, d, fx), fy); };
    const alpha = new Float32Array(w * h);   // burr height from the displaced volume
    const hf = new Float32Array(w * h), occ = new Float32Array(w * h), rn = rng(seed + i * 17);
    for (let k = 0; k < w * h; k++) {
      const s = sd[k];
      if (s < 0) { const u = clamp(-s / wall); hf[k] = -D * u * u * (3 - 2 * u) + (rn() - 0.5) * 0.35; occ[k] = lerp(1, 0.6, clamp(-s / (wall * 3))) ; }     // floor: struck grain, darker in the well
      else { const q = s / rb, n = vn(k % w, (k / w) | 0); hf[k] = B * (0.3 + 1.2 * n * n) * q * Math.exp(1 - q) * (s < 9 ? 1 : 0); occ[k] = 1; }
      alpha[k] = s < 16 ? 1 : clamp(1 - (s - 16) / 14);         // the patch feathers into the plate (no rectangle seams)
    }
    const alb = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const X = clamp(x0 + xx, 0, W - 1), Y = clamp(y0 + yy, 0, H - 1), s = (Y * W + X) * 4, d = (yy * w + xx) * 4;
      alb[d] = plate[s]; alb[d + 1] = plate[s + 1]; alb[d + 2] = plate[s + 2]; alb[d + 3] = 255; }
    const LO = { occl: occ, alpha, shadow: true, L: [-0.62, -0.5, 0.36], amb: 0.3, kd: 1.0 };
    const struck = put(relight(hf, w, h, alb, LO));
    // painted: the red rubbed into the dent (multiply tint in the well only), shading kept
    const tint = new Uint8ClampedArray(w * h * 4); for (let k = 0; k < w * h; k++) if (sd[k] < 0) { tint[k * 4] = paintInk[0]; tint[k * 4 + 1] = paintInk[1]; tint[k * 4 + 2] = paintInk[2]; tint[k * 4 + 3] = 235; }
    const painted = paintAfter != null ? put(relight(hf, w, h, alb, { ...LO, tint })) : null;
    // half-struck (the frame the die is in the metal): a shallower field
    const hf2 = hf.map(v => v * 0.55), mid = put(relight(hf2, w, h, alb, LO));
    return { G, i, x0, y0, w, h, struck, painted, mid, jit, cx: G.ox + jit.dx, cy: G.oy + jit.dy };
  });
  const at = i => strikes[i] ?? strikes[strikes.length - 1] ?? 0;
  // the punch: a square steel bar standing on the plate, seen from above-front; the hammer is off frame
  // the punch: a square steel bar standing on the plate, its mushroomed striking end in frame; the hammer comes down on
  // it on the strike frame (a dark steel head, the handle off to the upper right) and rebounds out of frame
  const drawPunch = (ctx, x, y, lift, w0, hammer = 0) => {
    const bw = w0, len = 470;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.beginPath(); ctx.ellipse(x + 30 + lift * 0.8, y + 18 + lift * 0.4, bw * 0.62, 26, 0, 0, 7); ctx.fill();   // its shadow, pushed off by the lift
    const yb = y - lift, top = yb - len, g1 = ctx.createLinearGradient(x - bw / 2, 0, x + bw / 2, 0);
    g1.addColorStop(0, '#dfe4e8'); g1.addColorStop(0.3, '#9aa2aa'); g1.addColorStop(0.7, '#4c5258'); g1.addColorStop(1, '#23272b');
    ctx.fillStyle = g1; ctx.fillRect(x - bw / 2, top, bw, yb - top);
    ctx.fillStyle = '#2d3136'; ctx.beginPath(); ctx.moveTo(x - bw / 2, yb); ctx.lineTo(x + bw / 2, yb); ctx.lineTo(x + bw / 2 - 10, yb + 14); ctx.lineTo(x - bw / 2 + 10, yb + 14); ctx.closePath(); ctx.fill();   // the chamfered face
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; for (let k = 0; k < 4; k++) ctx.fillRect(x - bw / 2 + 6, top + 80 + k * 90, bw - 12, 2);                 // knurling
    ctx.fillStyle = g1; ctx.beginPath(); ctx.ellipse(x, top, bw * 0.58, 22, 0, 0, 7); ctx.fill();                                              // the mushroomed head
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(x - bw * 0.1, top - 6, bw * 0.4, 9, 0, 0, 7); ctx.fill();
    if (hammer > 0) {                                                                                                             // the hammer head on the punch
      const hy = top - 20 - (1 - hammer) * 420, hw = 760, hh = 560;
      ctx.fillStyle = '#5a3a22'; ctx.save(); ctx.translate(x + 120, hy - hh / 2); ctx.rotate(-0.55); ctx.fillRect(0, -50, 1200, 100); ctx.restore();     // the handle
      const g2 = ctx.createLinearGradient(x - hw / 2, 0, x + hw / 2, 0); g2.addColorStop(0, '#6a7076'); g2.addColorStop(0.35, '#2a2e33'); g2.addColorStop(1, '#0e1012');
      ctx.fillStyle = g2; ctx.fillRect(x - hw / 2, hy - hh, hw, hh); ctx.fillStyle = '#9aa0a6'; ctx.fillRect(x - hw / 2, hy - 14, hw, 14);    // the face
    }
    ctx.restore();
  };
  const R = {
    block, hit: strikes[0],
    draw(ctx, t) {
      // camera kick: the most recent strike, 6 px on the strike frame, damped
      let kick = 0, last = -1; for (let i = 0; i < glyphs.length; i++) { const a = t - at(i); if (a >= 0) { last = i; const f = fr(a); kick = f === 0 ? 10 : f === 1 ? -5 : f === 2 ? 2 : 0; } }
      ctx.save(); ctx.translate(kick * 0.6, kick);
      ctx.drawImage(plateC, 0, 0);
      for (const g of glyphs) {
        const a = t - at(g.i); if (a < 0) continue; const f = fr(a);
        const pa = paintAfter != null ? clamp((t - paintAfter - g.i * 0.08) / 0.12) : 0;
        ctx.drawImage(f === 0 ? g.mid : g.struck, g.x0, g.y0);
        if (pa > 0 && g.painted) { ctx.globalAlpha = pa; ctx.drawImage(g.painted, g.x0, g.y0); ctx.globalAlpha = 1; }
      }
      // sparks off the die edge on the strike frame and the next two (world light: short streaks, no halo)
      for (const g of glyphs) { const a = t - at(g.i); if (a < 0 || a > 0.1) continue; const rr = rng(seed + g.i * 71);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        for (let k = 0; k < 14; k++) { const ang = -Math.PI * (0.05 + 0.9 * rr()), v = 700 + 1100 * rr(), x = g.cx + (rr() - 0.5) * g.G.bb.w, y0 = g.cy + g.G.bb.y2 * 0.9;
          const px = x + Math.cos(ang) * v * a, py = y0 + Math.sin(ang) * v * a + 1800 * a * a, al = clamp(1 - a / (0.06 + 0.06 * rr()));
          if (al <= 0) continue; ctx.strokeStyle = `rgba(255,${190 + rr() * 50 | 0},120,${al})`; ctx.lineWidth = 2 + rr() * 2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - Math.cos(ang) * 26, py - Math.sin(ang) * 26); ctx.stroke(); }
        ctx.restore(); }
      // one punch per letter (the workman takes the next punch from the rack): punch i drops in over its letter after the
      // previous blow, is held, the hammer lands on it ON its onset (frames 0-4: contact, a short bounce, gone), and it
      // is pulled away up out of frame from frame 2
      for (const g of glyphs) {
        const i = g.i, a = t - at(i), f = fr(a), prevT = i ? at(i - 1) + 2 / 30 : -1e9, gap = i ? at(i) - at(i - 1) : 1;
        let lift, show = true;
        if (a < 0) { if (t < prevT) continue; const m = clamp((t - prevT) / Math.min(0.14, gap * 0.45)); lift = i ? lerp(900, 34, ease.outCubic(m)) : 34; if (f === -1) lift = 16; }
        else if (f < 2) lift = 0;
        else { lift = lerp(0, 1500, ease.inCubic(clamp((a - 2 / 30) / 0.3))); if (lift > 1450) show = false; }
        if (!show) continue;
        drawPunch(ctx, g.cx, g.cy + g.G.bb.y1 * 0.1, lift, Math.max(150, g.G.bb.w + 50), f >= 0 && f < 5 ? [1, 0.93, 0.72, 0.4, 0.1][f] : 0);
      }
      ctx.restore();
      // the rake: a hard key from the upper left, everything else falls off (multiply)
      const gr = ctx.createRadialGradient(W * 0.2, H * 0.15, 200, W * 0.3, H * 0.3, 1700); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    },
    info(t) { const n = glyphs.filter(g => t >= at(g.i)).length; return { struck: n, of: glyphs.length, reads: n / glyphs.length, frame: fr(t - at(0)) }; },
  };
  return R;
}

// ================================================================ 5. teller's dater stamp (BANK payoff)
// A round bank dater: a ring legend, an inner rule, the date band, and the centre word at payoff scale. Rubber: ink
// starved in the solids, pooled at the edges, one side rocked lighter; struck with 2 frames of overpressure; multiply.
export function daterStamp({ faces, word = 'MONEY.', ring = ["THE PEOPLE'S NATIONAL BANK", 'OF THE UNITED STATES'], date = 'JUL 4 2036', cx = 520, cy = 800, R0 = 470, cap = 310, rcap = 56, ink = '#b8161d', rot = -0.1, seed = 11, sx = 1 } = {}) {
  const S = 2 * R0 + 80, L = canvas2d(S, S), g = L.g, c = S / 2, rr = rng(seed);
  g.fillStyle = ink; g.strokeStyle = ink;
  g.lineWidth = 16; g.beginPath(); g.arc(c, c, R0 - 8, 0, 7); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.arc(c, c, R0 - 48 - rcap, 0, 7); g.stroke();
  // the ring legend: the top arc reads left to right over the top (tops out), the bottom arc left to right along the
  // bottom (tops in), glyph by glyph as opentype outlines (not fillText)
  const rf = faces.ring, size = rcap / (((rf.tables.os2 && rf.tables.os2.sCapHeight) || rf.unitsPerEm * 0.7) / rf.unitsPerEm);
  const arc = (text, mid, top) => {
    const chars = [...text], adv = chars.map(ch => rf.charToGlyph(ch).advanceWidth * size / rf.unitsPerEm + 5), tot = adv.reduce((a, b) => a + b, 0);
    const rad = top ? R0 - 28 - rcap : R0 - 30, span = tot / rad; let ang = top ? mid - span / 2 : mid + span / 2;
    for (let i = 0; i < chars.length; i++) { const da = adv[i] / rad, a = top ? ang + da / 2 : ang - da / 2;
      g.save(); g.translate(c + Math.cos(a) * rad, c + Math.sin(a) * rad); g.rotate(top ? a + Math.PI / 2 : a - Math.PI / 2);
      const p = rf.charToGlyph(chars[i]).getPath(-adv[i] / 2 + 2.5, 0, size); p.fill = ink; p.draw(g); g.restore(); ang += top ? da : -da; }
  };
  const [rTop, rBot] = Array.isArray(ring) ? ring : [ring, ''];
  arc(rTop, -Math.PI / 2, true); if (rBot) arc(rBot, Math.PI / 2, false);
  for (const a of [Math.PI + 0.02, -0.02]) { const x = c + Math.cos(a) * (R0 - 22 - rcap / 2), y = c + Math.sin(a) * (R0 - 22 - rcap / 2); g.beginPath(); for (let k = 0; k < 10; k++) { const aa = k * Math.PI / 5 - Math.PI / 2, rr2 = k % 2 ? 9 : 22; g.lineTo(x + Math.cos(aa) * rr2, y + Math.sin(aa) * rr2); } g.fill(); }   // stars between the arcs
  // centre word (payoff scale), date band between two rules
  const wb = setBlock(faces.word, [{ text: word, cap }], { role: 'payoff', x: c, y: c - 40, sx, maxW: 2 * (R0 - 60 - rcap) * 0.96 });
  for (const G of wb.glyphs) { g.save(); g.translate(G.ox, G.oy); g.fill(G.path); g.restore(); }
  const db = setBlock(faces.ring, [{ text: date, cap: 50, tracking: 0.04 }], { role: 'micro', x: c, y: c + cap * 0.5 + 60, maxW: 900 });
  { const hw = Math.min(R0 - 90, (db.bbox.x2 - db.bbox.x1) / 2 + 40); g.fillRect(c - hw, c + cap * 0.5 + 16, 2 * hw, 7); g.fillRect(c - hw, c + cap * 0.5 + 98, 2 * hw, 7); }
  for (const G of db.glyphs) { g.save(); g.translate(G.ox, G.oy); g.fill(G.path); g.restore(); }
  // rubber: starve (voids), pool (a darker rim where the ink squeezes out), rock (one side lighter)
  g.save(); g.globalCompositeOperation = 'destination-out';
  salt(g, rr, 0, 0, S, S, 3200);
  for (let q = 0; q < 26; q++) { const x = rr() * S, y = rr() * S, R = 30 + rr() * 90, gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, `rgba(0,0,0,${0.15 + rr() * 0.25})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - R, y - R, 2 * R, 2 * R); }
  const rock = g.createLinearGradient(0, S * 0.1, S, S * 0.6); rock.addColorStop(0, 'rgba(0,0,0,0.4)'); rock.addColorStop(0.45, 'rgba(0,0,0,0.05)'); rock.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rock; g.fillRect(0, 0, S, S); g.restore();
  g.getImageData(0, 0, 1, 1);
  const R = {
    word: wb, sprite: L.cv,
    // age: s since the strike. Overpressure: 1.03 scale for 2 frames, then down
    draw(ctx, age = 1, { alpha = 1 } = {}) { if (age < 0) return; const s = fr(age) < 2 ? 1.03 : 1;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(s, s); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha *= alpha; ctx.drawImage(L.cv, -c, -c); ctx.restore(); },
    // the centre word's cap and width on screen (for the audit)
    audit() { return { cap: Math.round(wb.cap), wordW: Math.round(wb.bbox.x2 - wb.bbox.x1), diameter: 2 * R0, shrunk: wb.shrunk }; },
    place: { dx: cx - c, dy: cy - c, rot, pivot: [cx, cy] },
  };
  return R;
}

// salt: letterpress ink voids cluster where the roller starved (a few patches), sparse elsewhere; call inside destination-out
function salt(q, rr, x, y, w, h, n) {
  const cl = Array.from({ length: 9 }, () => [x + rr() * w, y + rr() * h, 30 + rr() * 90]);
  for (let k = 0; k < n; k++) { let px, py; if (rr() < 0.75) { const c = cl[k % cl.length], a = rr() * 7, d = c[2] * Math.sqrt(rr()); px = c[0] + Math.cos(a) * d; py = c[1] + Math.sin(a) * d * 0.6; } else { px = x + rr() * w; py = y + rr() * h; }
    q.fillStyle = `rgba(0,0,0,${0.35 + rr() * 0.65})`; q.beginPath(); q.ellipse(px, py, 0.5 + rr() * rr() * 3, 0.4 + rr() * 1.4, rr() * 3, 0, 7); q.fill(); }
}
// ================================================================ 6. broadside (1776 payoff)
// A Dunlap-style sheet: the dateline in small caps, a rule, SECOND in wood type, INDEPENDENCE. over it from a second
// impression in red (registered a few px off), a column of body type (sub-legible at feed size), an imprint line.
// hung(): the wet sheet pegged on the drying line in the shop, a slight sag between the pegs.
export function broadside({ faces, head = 'IN CHICAGO, JULY 21, 2024.', l1 = 'SECOND', l2 = 'INDEPENDENCE.', body = [], imprint = '', seed = 4, paper = [236, 226, 202], ink = '#15110f', red = '#b3141f', w = 1000, h = 1560, typeX = null, typeW = null } = {}) {
  // typeX / typeW: the display lines' centre and width on the sheet (keep them inside the feed's safe band once hung)
  const L = canvas2d(w, h), g = L.g;
  g.drawImage(paperStock({ w, h, seed, base: paper, tooth: 12, fibres: 2200, burn: 0.16 }), 0, 0);
  const cx = w / 2, imp = canvas2d(w, h), q = imp.g, rr = rng(seed + 1);
  const ink1 = (blk, col, dx = 0, dy = 0) => { q.fillStyle = col; for (const G of blk.glyphs) { q.save(); q.translate(G.ox + dx, G.oy + dy); q.fill(G.path); q.restore(); } };
  const hb = setBlock(faces.body, [{ text: head, cap: 30, tracking: 0.08 }], { role: 'micro', x: cx, y: 120, maxW: w - 120 });
  ink1(hb, ink); q.fillStyle = ink; q.fillRect(60, 160, w - 120, 4); q.fillRect(60, 170, w - 120, 1.5);
  const tx = typeX ?? cx, tw = typeW ?? w - 110;
  const b1 = setBlock(faces.wood, [{ text: l1, fill: true, max: 330 }], { role: 'payoff', x: tx, y: 360, maxW: tw });
  ink1(b1, ink);
  const b2 = setBlock(faces.cond, [{ text: l2, fill: true, max: 300 }], { role: 'payoff', x: tx, y: 690, maxW: tw });
  q.fillRect(60, 520, w - 120, 3);
  // body: two columns of small roman (text from the piece), set solid, ragged per line: sub-legible at feed size
  const bf = faces.body, bs = 27 / 0.7;
  q.fillStyle = ink; let k = 0; const colW = (w - 160) / 2, lines = [];
  const words = body.join(' ').split(/\s+/).filter(Boolean);
  while (k < words.length) { let line = ''; while (k < words.length) { const nx = (line ? line + ' ' : '') + words[k]; if (bf.getAdvanceWidth(nx, bs) > colW && line) break; line = nx; k++; } lines.push(line); }
  const per = Math.ceil(lines.length / 2);                   // two balanced columns, set solid
  lines.forEach((ln, i) => { const col = i < per ? 0 : 1; bf.getPath(ln, 60 + col * (colW + 40), 950 + (i % per) * 44, bs).draw(q); });
  { const yo = 950 + per * 44 + 40; q.fillRect(w / 2 - 160, yo, 320, 3); q.fillRect(w / 2 - 100, yo + 10, 200, 1.5); }
  q.fillRect(w / 2 - 1, 915, 2, per * 44 + 10);
  if (imprint) { const ib = setBlock(faces.body, [{ text: imprint, cap: 22, tracking: 0.06 }], { role: 'micro', x: cx, y: h - 90, maxW: w - 140 }); q.fillRect(60, h - 140, w - 120, 2); ink1(ib, ink); }
  // letterpress character on the black impression: salt, grain, squeezed rim
  q.save(); q.globalCompositeOperation = 'destination-out';
  salt(q, rr, 0, 180, w, 560, 1600);
  for (let n = 0; n < 140; n++) { const yy = 230 + rr() * 480, ph = rr() * 6, amp = 1 + rr() * 3; q.strokeStyle = `rgba(0,0,0,${0.04 + rr() * 0.1})`; q.lineWidth = 0.6 + rr() * 1.6;
    q.beginPath(); for (let x = 0; x <= w; x += 20) { const Y = yy + Math.sin(x * 0.012 + ph) * amp; x ? q.lineTo(x, Y) : q.moveTo(x, Y); } q.stroke(); }
  q.restore();
  for (const G of b1.glyphs) { q.save(); q.translate(G.ox, G.oy); innerShadow(q, G, 'rgba(0,0,0,0.3)', 2, 3, 2); q.restore(); }
  g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(imp.cv, 0, 0); g.restore();
  const first = canvas2d(w, h); first.g.drawImage(L.cv, 0, 0); first.g.getImageData(0, 0, 1, 1);   // the sheet after the black pass
  // the second impression: INDEPENDENCE. in red, its own register (a few px off), its own starve
  const im2 = canvas2d(w, h), q2 = im2.g; q2.fillStyle = red; for (const G of b2.glyphs) { q2.save(); q2.translate(G.ox + 3, G.oy - 2); q2.rotate(0.002); q2.fill(G.path); q2.restore(); }
  q2.save(); q2.globalCompositeOperation = 'destination-out'; salt(q2, rr, 0, 560, w, 300, 1100); q2.restore();
  for (const G of b2.glyphs) { q2.save(); q2.translate(G.ox + 3, G.oy - 2); innerShadow(q2, G, 'rgba(60,0,0,0.3)', 2, 3, 2); q2.restore(); }
  g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(im2.cv, 0, 0); g.restore();
  g.getImageData(0, 0, 1, 1);
  const R = {
    sheet: L.cv, first: first.cv, w, h, red, blocks: { head: hb, l1: b1, l2: b2 }, redOffset: [3, -2],
    // hung(ctx, x, y, o): the sheet on the line: pegs, a sag, a cast shadow on the back wall, the shop's lamp
    hung(ctx, x, y, { sag = 10, sway = 0 } = {}) {
      const n = 60;
      ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.moveTo(x + 24, y + 30); ctx.lineTo(x + w + 34, y + 30); ctx.lineTo(x + w + 30, y + h + 40); ctx.lineTo(x + 30, y + h + 36); ctx.closePath(); ctx.filter = 'blur(14px)'; ctx.fill(); ctx.filter = 'none'; ctx.restore();
      for (let k = 0; k < n; k++) { const u0 = k / n, x0 = x + u0 * w, sw = w / n + 1, dy = sag * Math.sin(Math.PI * u0) + sway * Math.sin(u0 * 7); ctx.drawImage(L.cv, u0 * w, 0, w / n, h, x0, y + dy, sw, h); }
      // the paper's own curl: darker at the free bottom edge, a soft fold light across the top third
      const gr = ctx.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, 'rgba(255,250,235,0.0)'); gr.addColorStop(0.3, 'rgba(255,250,235,0.06)'); gr.addColorStop(0.95, 'rgba(40,25,10,0.0)'); gr.addColorStop(1, 'rgba(40,25,10,0.3)');
      ctx.fillStyle = gr; ctx.fillRect(x, y, w, h + sag);
      ctx.strokeStyle = '#2a2520'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, y - 6); ctx.lineTo(W, y - 12); ctx.stroke();       // the line
      for (const px of [x + 40, x + w - 80]) { ctx.fillStyle = '#b89a6a'; ctx.fillRect(px, y - 30, 34, 74); ctx.fillStyle = '#6f5a3a'; ctx.fillRect(px + 15, y - 30, 4, 74); }   // wooden pegs
    },
  };
  return R;
}
