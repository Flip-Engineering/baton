// 1776 / SECOND INDEPENDENCE (v9, the press cut). Cycle-1 brief (videos/review/1776_c1/): a metric montage cut on the
// kicks. Frame 0 is the seal macro (the brass matrix lifting off, the rim cracking) with 1776 AGAIN. struck on a cream
// slip; the loop closes on the same slip carrying the lockup. Woodcut trade plates, the square reading the broadside from
// behind, the Crown's seal snapping, the SAME WORDS split, the pen passed in silhouette, the Klutsis wall of hands, the
// press run with the town stamp, the wax drop in the silence and the hall rising (unfinished3.inserts.js). The desk keeps
// the lettering, the red signatories and the seals; its hand is backlit to a silhouette with a candle rim. Every word is
// wood type printed into the paper in frame (no caption bar); the payoffs are the largest type. No corner bug; no red
// flood (the paper stays cream, the red is the ink of the wall and the wax bleeding round the seal).
//
// v8 notes (kept):
// 1776 / SECOND INDEPENDENCE (v8, the desk). 1776 again. Farmers, mechanics, sailors: a people's revolution broke an empire.
// Round two: Chicago, July 21, 2024, the same words. Enough. Pass the pen: the red signatories. Same people. All hands.
// Sign me up. On your feet: working class declares. Second independence. The ACP mark pressed in as the seal.
//
// Built from unfinished2 (v6 real lettering). v7 added the desk, the hand, both sheets and the seal; v8 (the review of the
// v7 stills, videos/review/unfinished3/) rebuilt:
//  - the hand (unfinished3.hand.js): a right hand in a true tripod grip (v7's was mirrored), knuckle creases, nails, veins,
//    light through the fingertips; a goose quill with bundled barbs and splits; the 1776 gathered linen under a
//    broadcloth cuff with two buttons, the 2024 duck-canvas jacket (weave, triple stitching, a frayed buttoned cuff) on a
//    heavier, tanned, scarred working hand. The sleeve runs a metre, so the arm always leaves the frame. Baked along the
//    camera's mean view (20° up the page), so the parallax and the quill's overhang are right; its height feeds the DOF.
//  - sheet 1: only the first line reads (the body is small soft period script: no 'equal', no 'Nature's God', no 'right'
//    at phone size); IN CONGRESS in capitals; the signers' abbreviations with their raised letters; a close track across
//    the state columns, two at a time, while the hand signs the head of each.
//  - the red signatories: two period hands (Pinyon, Tangerine bold) with unambiguous capitals, even sizes, N. Lenin (his
//    English byline), Harry Haywood (§6.4 keeps the syndicalists off), Benj. J. Davis, Jr.; the pen signs the four
//    classics, the Americans come in two bursts of four.
//  - the red: it wicks out of the workers' strokes through the fibres (a Dijkstra over a fibre-noise field), bottom rows
//    first, as a dye wash, and takes the whole sheet from the foot up at 48; brick-to-crimson, every fibre still showing.
//  - the seals: the Art. III mark (45° tilt, four stripes, ACP) at its fixed angle, oxblood wax with a lighter lip, rim
//    '1776 · 2024 ·'; one central seal on 50 and one on each ALL HANDS. hit (52-55), none on another; silk ribbons.
//  - the words: long frames set condensed (Playfair squeezed to 0.56) so the payoffs hit near the one-word size; the
//    stamps sit on the paper; a warm highlight flash of 2-3 frames (no milky wash); a new framing every phrase from 48;
//    the push into the central seal from 56; the lockup cut: the ☭≡/acc closer is the last 1.4 s (64.67-68).
// Words: research/scripts_final/unfinished.json (v7 cue table). Song: songs2/unfinished3.py (the m2 song re-voiced to these
// words, no musket volleys, 17 bars, 28.3 s).
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, rng, line, headline,
  Finish, sigil, closer, outCanvas, seq, BRAND, tinted } from '../lib/kit.js';
import { woodtype, plates, square, crown, split, passPen, hands, press, waxDrop, rise } from './unfinished3.inserts.js';

// every 2D canvas here is CPU-backed: the sheets are big, redrawn each frame and uploaded to WebGL, and on the software
// GPU a GPU-backed 2D canvas costs seconds per readback
{ const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, o) { return gc.call(this, type, type === '2d' ? { willReadFrequently: true, ...(o || {}) } : o); }; }
const ctx = outCanvas();
await loadFonts();
const FD = '../node_modules/@fontsource';
const HAND = { fell: 'IM Fell English', sc: 'IM Fell English SC', copper: 'Pinyon Script',
  delafield: 'Mrs Saint Delafield', herr: 'Herr Von Muellerhoff', doulaise: 'Monsieur La Doulaise', aurore: 'La Belle Aurore',
  vibes: 'Great Vibes', apple: 'Homemade Apple', meddon: 'Meddon', haviland: 'Mr De Haviland', tangerine: 'Tangerine',
  madi: 'Ms Madi', italianno: 'Italianno', imperial: 'Imperial Script' };
await Promise.all([
  ['IM Fell English', 'im-fell-english/files/im-fell-english-latin-400-normal.woff2', {}],
  ['IM Fell English', 'im-fell-english/files/im-fell-english-latin-400-italic.woff2', { style: 'italic' }],
  ['IM Fell English SC', 'im-fell-english-sc/files/im-fell-english-sc-latin-400-normal.woff2', {}],
  ['Pinyon Script', 'pinyon-script/files/pinyon-script-latin-400-normal.woff2', {}],
  ['Pinyon Script', 'pinyon-script/files/pinyon-script-latin-ext-400-normal.woff2', { unicodeRange: 'U+017F' }],   // the long s
  ['Mrs Saint Delafield', 'mrs-saint-delafield/files/mrs-saint-delafield-latin-400-normal.woff2', {}],
  ['Herr Von Muellerhoff', 'herr-von-muellerhoff/files/herr-von-muellerhoff-latin-400-normal.woff2', {}],
  ['Monsieur La Doulaise', 'monsieur-la-doulaise/files/monsieur-la-doulaise-latin-400-normal.woff2', {}],
  ['La Belle Aurore', 'la-belle-aurore/files/la-belle-aurore-latin-400-normal.woff2', {}],
  ['Great Vibes', 'great-vibes/files/great-vibes-latin-400-normal.woff2', {}],
  ['Homemade Apple', 'homemade-apple/files/homemade-apple-latin-400-normal.woff2', {}],
  ['Playfair Display', 'playfair-display/files/playfair-display-latin-900-normal.woff2', { weight: '900' }],
  // v8: period hands with unambiguous capitals (I, J), and an 18th-century round hand for the engrossed heading
  ['Meddon', 'meddon/files/meddon-latin-400-normal.woff2', {}],
  ['Mr De Haviland', 'mr-de-haviland/files/mr-de-haviland-latin-400-normal.woff2', {}],
  ['Tangerine', 'tangerine/files/tangerine-latin-400-normal.woff2', {}],
  ['Tangerine', 'tangerine/files/tangerine-latin-700-normal.woff2', { weight: '700' }],
  ['Ms Madi', 'ms-madi/files/ms-madi-latin-400-normal.woff2', {}],
  ['Italianno', 'italianno/files/italianno-latin-400-normal.woff2', {}],
  ['Imperial Script', 'imperial-script/files/imperial-script-latin-400-normal.woff2', {}],
].map(async ([name, file, desc]) => document.fonts.add(await new FontFace(name, `url(${FD}/${file})`, desc).load())));
const B = await loadBeats('unfinished3');
const logo = await loadImage('../assets/acp_logo_dark.png');
// the writing hand, baked by bake_unfinished3_hand.mjs: per sleeve the hand (fine) and the whole arm (coarse), colour + height
const HANDMETA = await (await fetch('../assets/unfinished3_hand.json')).json();
const HANDIMG = {}; await Promise.all(Object.keys(HANDMETA).map(async k => { HANDIMG[k] = await loadImage(`../assets/unfinished3_${k}.png`); }));
const finish = new Finish(1776);
const INKC = '#24140a', RED = '#9c0f1c', WAX = '#a3141f';

// ================================================================ words (research/scripts_final/unfinished.json, v9)
// Desk-shot type: wood type printed into the paper in frame (multiply), [beat0, beat1, lines, colour, y (screen px), em].
// The 2D inserts print their own words (unfinished3.inserts.js). The payoffs (48, 50) are the largest type in the piece.
const INKR = '#b3121c', INKB = '#18130f';
// 'slip': printed on the cream slip laid under the seal (frame 0, the payoffs, the callback, the lockup): one surface
const DESK_TYPE = [
  [16, 17.7, 'ROUND TWO.', INKR, 1250, 190],
  [24, 25.85, 'ENOUGH.', INKR, 1300, 200],
  [32, 33.85, 'SAME PEOPLE.', INKB, 1130, 170, 1],
  [48, 49.9, ['WORKING CLASS', 'DECLARES.'], INKB, 'slip', 300],
  [50, 51.95, ['SECOND', 'INDEPENDENCE.'], INKR, 'slip', 300],
  [52, 52.9, 'ALL HANDS.', INKB, 1180, 200, 1],
  [54, 54.9, 'ALL HANDS.', INKB, 1180, 200, 1],
  [56, 58.6, ['1776', 'AGAIN.'], INKR, 'slip', 280],
];
const CLOSE_AT = 64.67;                                           // the push lands on the seal at 64; the closer is the last 1.4 s

// ================================================================ the sheets: 1080 x 1920 units, textures at PS px per unit
const PS = 1.5, PW = W, PH = H, TW = PW * PS, TH = PH * PS;
const CM = 22;                                                   // page units per centimetre (the hand's scale)
function sheetCanvas() { const c = document.createElement('canvas'); c.width = Math.round(TW); c.height = Math.round(TH); return c; }
function deckle(g, seed, laid) {                                 // the sheet's outline (units): never a pinked or perforated edge
  // parchment (sheet 1): trimmed, low-frequency wander, worn round corners, a few chips and a nick or two;
  // laid cotton (sheet 2): a clean mill cut with the faintest waviness
  const r = rng(seed * 13 + 5), inset = 8, amp = laid ? 1.2 : 5.5, cr = laid ? 6 : 26;
  const K = 48, knots = Array.from({ length: K + 1 }, () => r() - 0.5); knots[K] = knots[0];
  const smooth = u => { const x = (u % 1 + 1) % 1 * K, i = Math.floor(x), f = x - i, e = f * f * (3 - 2 * f); return lerp(knots[i], knots[i + 1], e); };
  const chips = laid ? [] : Array.from({ length: 9 }, () => ({ u: r(), w: 0.004 + r() * 0.012, d: 3 + r() ** 2 * 11 }));
  const per = 2 * (PW + PH), off = u => { let o = amp * (smooth(u) + 0.35 * smooth(u * 3.7 + 0.3));
    for (const c of chips) { const d = Math.abs(u - c.u); if (d < c.w) o += c.d * Math.cos(d / c.w * Math.PI / 2) ** 2 * (0.7 + 0.3 * Math.sin(u * 900)); }
    return Math.max(0, o + amp * 0.6); };
  const x0 = inset, y0 = inset, x1 = PW - inset, y1 = PH - inset, pts = [];
  // walk the rounded rectangle; push each point inward along its normal by the edge offset
  const segs = [[x0 + cr, y0, x1 - cr, y0, 0, 1], [x1, y0 + cr, x1, y1 - cr, -1, 0], [x1 - cr, y1, x0 + cr, y1, 0, -1], [x0, y1 - cr, x0, y0 + cr, 1, 0]];
  const corners = [[x1 - cr, y0 + cr, -Math.PI / 2], [x1 - cr, y1 - cr, 0], [x0 + cr, y1 - cr, Math.PI / 2], [x0 + cr, y0 + cr, Math.PI]];
  let acc = 0;
  segs.forEach(([ax, ay, bx, by, nx, ny], k) => {
    const len = Math.hypot(bx - ax, by - ay), n = Math.ceil(len / 4);
    for (let i = 0; i <= n; i++) { const t = i / n, u = (acc + t * len) / per, o = off(u); pts.push([lerp(ax, bx, t) + nx * o, lerp(ay, by, t) + ny * o]); }
    acc += len;
    const [cx, cy, a0] = corners[k], wear = laid ? 0 : r() * 7;
    for (let i = 1; i < 10; i++) { const a = a0 + i / 10 * Math.PI / 2, u = acc / per, o = off(u) + wear * Math.sin(i / 10 * Math.PI);
      pts.push([cx + Math.cos(a) * (cr - o), cy + Math.sin(a) * (cr - o)]); }
  });
  g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
}
function paper(seed, { c0, c1, c2, fox = 14, laid = false, folds = false, stain = 0 }) {
  const p = sheetCanvas(), g = p.getContext('2d'), r = rng(seed);
  g.scale(PS, PS);
  g.save(); deckle(g, seed, laid); g.clip();
  const gr = g.createRadialGradient(PW * 0.45, PH * 0.4, 200, PW / 2, PH / 2, PH * 0.8);
  gr.addColorStop(0, c0); gr.addColorStop(0.62, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; g.fillRect(0, 0, PW, PH);
  const lo = document.createElement('canvas'); lo.width = 108; lo.height = 192; const gl = lo.getContext('2d');   // mottling, drawn small, scaled up soft
  for (let i = 0; i < 300; i++) { gl.fillStyle = `rgba(${90 + r() * 60},${60 + r() * 40},${30 + r() * 20},${(laid ? 0.008 : 0.018) + r() * 0.03})`;
    gl.beginPath(); gl.ellipse(r() * 108, r() * 192, lerp(3, 22, r() ** 2), lerp(2, 14, r() ** 2), r() * 3, 0, 7); gl.fill(); }
  g.imageSmoothingQuality = 'high'; g.drawImage(lo, 0, 0, PW, PH);
  if (laid) {                                                    // laid and chain lines of the mould
    for (let y = 0; y < PH; y += 2.3) { g.fillStyle = `rgba(120,100,70,${0.018 + r() * 0.012})`; g.fillRect(0, y, PW, 0.55); }
    for (let x = 20 + r() * 20; x < PW; x += 56) { g.fillStyle = 'rgba(110,90,60,0.05)'; g.fillRect(x, 0, 1.4, PH); g.fillStyle = 'rgba(255,250,240,0.05)'; g.fillRect(x + 1.6, 0, 1.2, PH); }
  }
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${100 + r() * 50},${70 + r() * 30},${35 + r() * 20},${0.03 + r() * 0.05})`;
    g.beginPath(); g.arc(r() * PW, r() * PH, lerp(0.5, 3.5, r() ** 2), 0, 7); g.fill(); }
  g.lineCap = 'round';
  for (let i = 0; i < 7000; i++) {                               // fibres
    const x = r() * PW, y = r() * PH, a = r() * Math.PI, l = 2 + r() * 16;
    g.strokeStyle = r() < 0.5 ? `rgba(110,80,45,${0.04 + r() * 0.07})` : `rgba(255,248,228,${0.05 + r() * 0.09})`;
    g.lineWidth = 0.25 + r() * 0.5; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < fox; i++) {                                // foxing: rust spots with darker cores
    const x = r() * PW, y = r() * PH, rad = 4 + r() * 22, fg = g.createRadialGradient(x, y, 0, x, y, rad);
    fg.addColorStop(0, 'rgba(120,70,30,0.3)'); fg.addColorStop(0.3, 'rgba(140,90,40,0.16)'); fg.addColorStop(1, 'rgba(140,90,40,0)');
    g.fillStyle = fg; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < stain; i++) {                              // tide-marked water stains
    const x = r() * PW, y = r() * PH, rad = 60 + r() * 140;
    g.strokeStyle = 'rgba(120,80,40,0.1)'; g.lineWidth = 2 + r() * 3; g.beginPath(); g.ellipse(x, y, rad, rad * lerp(0.6, 1, r()), r() * 3, 0, 7); g.stroke();
    const sg = g.createRadialGradient(x, y, rad * 0.2, x, y, rad); sg.addColorStop(0, 'rgba(150,110,60,0)'); sg.addColorStop(1, 'rgba(150,110,60,0.07)');
    g.fillStyle = sg; g.beginPath(); g.ellipse(x, y, rad, rad * 0.8, 0, 0, 7); g.fill();
  }
  if (folds) {                                                   // the old folds: a shadow and a lit side
    for (const [x0, y0, x1, y1] of [[0, PH * 0.34, PW, PH * 0.335], [0, PH * 0.67, PW, PH * 0.672], [PW * 0.5, 0, PW * 0.503, PH]]) {
      g.strokeStyle = 'rgba(90,60,30,0.11)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = 'rgba(255,245,225,0.13)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x0 + 2, y0 + 2); g.lineTo(x1 + 2, y1 + 2); g.stroke();
    }
  }
  g.restore();
  // the deckle: fibrous, lighter, a little translucent, then a browned rim just inside it
  g.save(); deckle(g, seed, laid); g.clip();
  g.lineWidth = laid ? 10 : 46; g.strokeStyle = laid ? 'rgba(150,120,80,0.1)' : 'rgba(105,66,32,0.3)'; g.filter = `blur(${laid ? 4 : 14}px)`;
  deckle(g, seed, laid); g.stroke(); g.filter = 'none';
  if (!laid) { g.lineWidth = 1.6; g.strokeStyle = 'rgba(80,48,22,0.35)'; deckle(g, seed, laid); g.stroke(); }   // the trimmed, handled rim
  g.restore();
  return p;
}
const PAPER1 = paper(4, { c0: '#eedfbd', c1: '#dcc496', c2: '#9c7a48', fox: 26, folds: true, stain: 0 });   // no ring stains: they read as a mug
const PAPER2 = paper(21, { c0: '#f6eedb', c1: '#ece0c3', c2: '#c9b48c', fox: 6, laid: true });

// ================================================================ inked items: text pre-rendered once (px), revealed by the quill
const INK = { iron: '#27160b', brown: '#3d2615', black: '#150e09', blue: '#14131d', red: '#8e0d19' };
const MEAS = document.createElement('canvas').getContext('2d');
// runs: a line may mix faces ([{ t, family, size }]) and carry raised letters ('Sam^l Adams': the ^ raises the letters
// after it up to the next non-letter, small, as 18th-century hands wrote their abbreviations)
function parseRuns(text, family, size, fw, style) {
  if (Array.isArray(text)) return text.map(r => ({ family, size, fw, style, dy: 0, ...r }));
  const out = []; let cur = '', i = 0;
  const push = (t, sup) => { if (t) out.push({ t, family, fw, style, size: sup ? size * 0.6 : size, dy: sup ? -size * 0.36 : 0 }); };
  while (i < text.length) {
    if (text[i] === '^') { push(cur, false); cur = ''; i++; let sup = ''; while (i < text.length && /[a-z]/i.test(text[i])) sup += text[i++]; push(sup, true); continue; }
    cur += text[i++];
  }
  push(cur, false); return out;
}
const runFont = (r, k) => `${r.style || ''} ${r.fw || ''} ${r.size * k}px "${r.family}"`.trim().replace(/\s+/g, ' ');
function inkItem({ text, family, size, x, y, align = 'left', color = INK.iron, t0, t1, rot = 0, weight = 0, style = '', fw = '', paraph = null, alpha = 1, blot = 0, red = false, soft = 0 }) {
  const k = PS, runs = parseRuns(text, family, size, fw, style);
  let asc0 = 0, desc0 = 0, adv = 0, lb = 0;
  for (const r of runs) { MEAS.font = runFont(r, k); const m = MEAS.measureText(r.t); r.x = adv; r.w = m.width;
    if (r === runs[0]) lb = Math.max(0, m.actualBoundingBoxLeft);
    asc0 = Math.max(asc0, m.actualBoundingBoxAscent - r.dy * k); desc0 = Math.max(desc0, m.actualBoundingBoxDescent + r.dy * k);
    adv += m.width; r.right = r.x + Math.max(m.width, m.actualBoundingBoxRight); }
  if (Array.isArray(text)) text = runs.map(r => r.t).join('');
  const mt = { actualBoundingBoxLeft: lb };
  const padX = size * k * 0.5, asc = Math.max(asc0, size * k * 0.8) + 12 * k, desc = Math.max(desc0, size * k * 0.3) + 12 * k;
  const tw = Math.max(adv, ...runs.map(r => r.right)) + lb;
  const extraW = paraph ? paraph.w * k : 0, extraH = paraph ? paraph.h * k : 0;
  const cw = Math.ceil(tw + padX * 2 + extraW), ch = Math.ceil(asc + desc + extraH);
  const ox = padX + Math.max(0, mt.actualBoundingBoxLeft), oy = asc;
  const draw = col => {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    g.fillStyle = col; g.strokeStyle = col; g.lineJoin = 'round'; g.lineCap = 'round';
    const each = f => { for (const r of runs) { g.font = runFont(r, k); f(r.t, ox + r.x, oy + r.dy * k); } };
    // iron-gall bleed: a faint brown halo wicked into the fibres, then the stroke itself
    g.globalAlpha = 0.22 * alpha; g.filter = `blur(${1.6 * k}px)`; each((t, xx, yy) => g.fillText(t, xx, yy)); g.filter = 'none';
    g.globalAlpha = alpha; g.shadowColor = col; g.shadowBlur = 1.1 * k;
    if (soft) g.filter = `blur(${soft * k}px)`;                   // body texture: period script, too soft to read at phone size
    each((t, xx, yy) => g.fillText(t, xx, yy));
    if (weight) { g.lineWidth = weight * k; each((t, xx, yy) => g.strokeText(t, xx, yy)); }
    g.filter = 'none';
    if (paraph) paraph.draw(g, ox, oy, tw, col, k);
    g.shadowBlur = 0; g.globalCompositeOperation = 'source-atop';
    if (blot) {                                                   // fresh dip: the first strokes run full and pool darker
      const bx = ox + size * k * 0.15, by = oy - size * k * 0.25, pg = g.createRadialGradient(bx, by, 0, bx, by, size * k * 0.4);
      pg.addColorStop(0, 'rgba(4,2,1,0.45)'); pg.addColorStop(1, 'rgba(4,2,1,0)'); g.fillStyle = pg; g.fillRect(0, 0, cw, ch);
    }
    const lg = g.createLinearGradient(0, 0, cw, 0);                // the quill runs dry along the stroke
    lg.addColorStop(0, 'rgba(10,5,2,0.22)'); lg.addColorStop(0.5, 'rgba(10,5,2,0)'); lg.addColorStop(1, 'rgba(150,110,70,0.2)');
    g.fillStyle = lg; g.fillRect(0, 0, cw, ch);
    const r = rng(text.length * 31 + size);                        // pooled ink where strokes pause
    for (let i = 0; i < 3 + text.length * 0.6; i++) { const px = ox + r() * tw, py = oy - r() * size * k * 0.7, pr = (0.4 + r()) * k * 2.2;
      const pg = g.createRadialGradient(px, py, 0, px, py, pr); pg.addColorStop(0, 'rgba(0,0,0,0.35)'); pg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = pg; g.fillRect(px - pr, py - pr, pr * 2, pr * 2); }
    return c;
  };
  const cv = draw(color), cvRed = red ? draw(INK.red) : null;
  const id = cv.getContext('2d').getImageData(0, 0, cw, ch).data;   // per-column ink: where the nib sits, how long each column takes
  const nibY = new Float32Array(cw), cum = new Float32Array(cw + 1);
  let lastY = oy - size * k * 0.2;
  for (let xx = 0; xx < cw; xx++) {
    let s = 0, sy = 0;
    for (let yy = 0; yy < ch; yy += 3) { const a = id[(yy * cw + xx) * 4 + 3]; if (a > 70) { s++; sy += yy; } }
    if (s) lastY = lerp(lastY, sy / s, 0.5);
    nibY[xx] = lastY; cum[xx + 1] = cum[xx] + 0.35 + Math.min(s, 14);
  }
  let left = x - ox / k;
  if (align === 'center') left = x - ox / k - tw / k / 2 - extraW / k / 2; else if (align === 'right') left = x - ox / k - tw / k;
  return { cv, cvRed, cw, ch, left, top: y - oy / k, rot, t0, t1, nibY, cum, total: cum[cw], redK: 0, text, ox, oy, tw, size };
}
const U = it => ({ l: it.left + it.ox / PS, r: it.left + (it.ox + it.tw) / PS, t: it.top, b: it.top + it.ch / PS, base: it.top + it.oy / PS });
function revealCol(it, u) { const target = u * it.total; let lo = 0, hi = it.cw;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (it.cum[mid] < target) lo = mid + 1; else hi = mid; } return lo; }
function toPage(it, lx, ly) { const c = Math.cos(it.rot), s = Math.sin(it.rot); lx /= PS; ly /= PS; return [it.left + lx * c - ly * s, it.top + lx * s + ly * c]; }
const FE = 10, STRIP = document.createElement('canvas'); STRIP.width = FE + 2; STRIP.height = 1400;
const gStrip = STRIP.getContext('2d'), RAMP = gStrip.createLinearGradient(0, 0, FE + 2, 0);
RAMP.addColorStop(0, 'rgba(0,0,0,1)'); RAMP.addColorStop(1, 'rgba(0,0,0,0)');
function reveal(g, cv, col, cw, ch, live, alpha) {
  g.globalAlpha = alpha;
  const solid = live ? Math.max(0, col - FE) : col;
  if (solid > 0) g.drawImage(cv, 0, 0, solid, ch, 0, 0, solid, ch);
  if (live) { const sw = Math.min(FE + 2, cw - solid);
    if (sw > 0) { gStrip.globalCompositeOperation = 'copy'; gStrip.drawImage(cv, solid, 0, sw, ch, 0, 0, sw, ch);
      gStrip.globalCompositeOperation = 'destination-in'; gStrip.fillStyle = RAMP; gStrip.fillRect(0, 0, FE + 2, ch);
      g.drawImage(STRIP, 0, 0, sw, ch, solid, 0, sw, ch); } }
  g.globalAlpha = 1;
}
const progress = (it, b) => b < it.t0 ? 0 : b >= it.t1 ? 1 : (b - it.t0) / (it.t1 - it.t0);
function drawItems(g, items, b) {                               // g is in page units
  for (const it of items) {
    if (b < it.t0) continue;
    const u = progress(it, b), col = u >= 1 ? it.cw : revealCol(it, u);
    if (col <= 0) continue;
    g.save(); g.translate(it.left, it.top); if (it.rot) g.rotate(it.rot); g.scale(1 / PS, 1 / PS);
    const rm = it.cvRed ? it.redK : 0;
    if (rm < 1) reveal(g, it.cv, col, it.cw, it.ch, u < 1, 1);
    if (rm > 0) reveal(g, it.cvRed, col, it.cw, it.ch, u < 1, rm);
    if (u < 1) { const ny = it.nibY[Math.min(col, it.cw - 1)], wg = g.createRadialGradient(col, ny, 0, col, ny, 5 * PS);   // wet bead at the nib
      wg.addColorStop(0, rm > 0.5 || it.redInk ? 'rgba(110,6,14,0.6)' : 'rgba(10,5,2,0.6)'); wg.addColorStop(1, 'rgba(10,5,2,0)');
      g.fillStyle = wg; g.fillRect(col - 5 * PS, ny - 5 * PS, 10 * PS, 10 * PS); }
    g.restore();
  }
}
function nibOf(it, b) { const u = progress(it, b), col = u >= 1 ? it.cw - 1 : revealCol(it, u); const c = Math.min(Math.max(col, 0), it.cw - 1);
  return toPage(it, c, it.nibY[c]); }
function wrap(text, family, size, maxW, style = '') {
  MEAS.font = `${style} ${size}px "${family}"`.trim();
  const out = []; let cur = '';
  for (const w of text.split(' ')) { const t = cur ? cur + ' ' + w : w; if (MEAS.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  return out;
}
const mixHex = (a, b, u) => '#' + [1, 3, 5].map(i => Math.round(lerp(parseInt(a.slice(i, i + 2), 16), parseInt(b.slice(i, i + 2), 16), u)).toString(16).padStart(2, '0')).join('');
const DIP = { r: rng(1787), left: 0, n: 0 };
// lead < 1: the writing montage. The quill writes the first `lead` of each line at a hand's pace, then the rest of the
// line is simply there (a time cut on the beat); the popped words are left off the pen's path (it.pop)
function block(items, lines, { x, y, lh, size, family = HAND.copper, b0, b1, indent = 0, ink0 = INK.black, ink1 = INK.brown, soft = 0, lead = 1, alpha = 1 }) {
  const n = lines.length, per = (b1 - b0) / n, r = DIP.r;
  MEAS.font = `${size}px "${family}"`; const sp = MEAS.measureText(' ').width;
  lines.forEach((ln, i) => {
    MEAS.font = `${size}px "${family}"`;                          // (inkItem re-sets it at the sheet's px scale)
    const words = ln.split(' '), ws = words.map(w => MEAS.measureText(w).width);
    const tot = ws.reduce((a, c) => a + c, 0) + sp * (words.length - 1), lt0 = b0 + i * per, ldur = 0.9 * per;
    let wx = x + (i === 0 ? indent : 0), acc = 0;
    words.forEach((w, j) => {
      let blot = 0;
      if (DIP.left <= 0) { DIP.left = 5 + Math.floor(r() * 3); DIP.n = 0; blot = 1 + r(); }
      const fade = DIP.n < 2 ? 0 : clamp((DIP.n - 1) / (DIP.left + DIP.n - 2));
      DIP.left--; DIP.n++;
      const lw = tot * lead, pop = lead < 1 && acc + ws[j] > lw && j > 0;
      const it = inkItem({ text: w, family, size, x: wx, y: y + i * lh + (r() - 0.5) * 2.5, rot: (r() - 0.5) * 0.006,
        color: mixHex(ink0, ink1, fade), alpha: alpha * lerp(1, 0.84, fade), blot, soft,
        t0: pop ? lt0 + ldur : lt0 + ldur * acc / Math.max(lw, acc + ws[j]), t1: pop ? lt0 + ldur : lt0 + ldur * (acc + ws[j]) / Math.max(lw, acc + ws[j]) });
      it.pop = pop; items.push(it);
      acc += ws[j] + sp; wx += ws[j] + sp * (1 + (r() - 0.5) * 0.18);
    });
  });
  return y + n * lh;
}
function underline(g, x0, x1, yb, seed, u, col = INK.blue) {     // an underscore pulled with the pen; returns the tip
  if (u <= 0) return null;
  const r = rng(seed), bend = (r() - 0.5) * 10, N = 40, f = t => [lerp(x0, x1, t), yb + bend * Math.sin(t * Math.PI) - t * 5];
  const m = Math.min(N, u * N);
  g.save(); g.strokeStyle = col; g.lineCap = 'round'; g.shadowColor = col; g.shadowBlur = 1.2;
  for (let i = 1; i <= Math.ceil(m); i++) { const a = f((i - 1) / N), b = f(Math.min(i, m) / N);
    g.lineWidth = 1.2 + 3.2 * Math.sin(Math.min(i, m) / N * Math.PI); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
  g.restore();
  return f(m / N);
}
// a broad-nib stroke: the width follows the stroke's direction against the nib (held at about 40°), as a cut quill does
function nibStroke(g, pts, k, wMin, wMax, nibA = 0.7) {
  for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i], a = Math.atan2(by - ay, bx - ax);
    const t = i / pts.length, taper = Math.min(1, t * 12, (1 - t) * 6);
    g.lineWidth = k * lerp(wMin, wMax, Math.abs(Math.sin(a - nibA)) * taper); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); }
}
function paraphHancock(g, ox, oy, tw, col, k) {                  // Hancock's paraph: from the k, back under the name in a chain
  g.save(); g.shadowBlur = 0; g.strokeStyle = col; g.lineCap = 'round';   // of flat, uneven loops, then a long closing sweep
  const pts = [], x0 = ox + tw + 6 * k, y0 = oy + 8 * k, L = tw * 0.92, n = 5.5;
  for (let t = 0; t <= 1; t += 0.0015) {
    const ph = t * n * Math.PI * 2, R = k * (13 + 11 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * (0.85 + 0.15 * Math.sin(ph * 0.37 + 1));
    const adv = L * (t + 0.05 * Math.sin(t * 7)), tilt = -0.35;
    const lx = -adv + R * 1.25 * Math.sin(ph), ly = R * (1 - Math.cos(ph)) * 0.75 + t * 34 * k;
    pts.push([x0 + lx * Math.cos(tilt) - ly * Math.sin(tilt) * 0.3, y0 + 22 * k + ly + lx * Math.sin(tilt) * 0.08]); }
  const e = pts[pts.length - 1];                                  // the closing sweep back to the right, under everything
  for (let t = 0; t <= 1; t += 0.01) pts.push([e[0] + t * tw * 0.95, e[1] + 10 * k * Math.sin(t * Math.PI) + t * 6 * k - t * t * 18 * k]);
  nibStroke(g, pts, k, 0.9, 4.6);
  g.restore();
}
function paraphSwash(seed) {
  return (g, ox, oy, tw, col, k) => { const r = rng(seed); g.save(); g.shadowBlur = 0; g.strokeStyle = col; g.lineCap = 'round';
    const x0 = ox + tw * lerp(0.0, 0.2, r()), x1 = ox + tw * lerp(0.85, 1.05, r()), yb = oy + (12 + r() * 8) * k, bend = (r() - 0.5) * 20 * k;
    const hook = r() < 0.5, pts = [];
    for (let i = 0; i <= 50; i++) { const t = i / 50; pts.push([lerp(x0, x1, t), yb + bend * Math.sin(t * Math.PI) - t * 6 * k]); }
    if (hook) { const [ex, ey] = pts[50]; for (let i = 1; i <= 16; i++) { const a = i / 16 * Math.PI * 1.3; pts.push([ex + Math.sin(a) * 9 * k, ey - (1 - Math.cos(a)) * 7 * k]); } }
    nibStroke(g, pts, k, 0.8, 3.2);
    g.restore(); };
}

// ================================================================ SHEET 1: In Congress, July 4, 1776 (engrossed copy) [VERIFY-NARA]
// Only the first line is legible (r1776 §6 #5, #6): the rest of the text is small, soft period script. The engrossed heading
// is an engrosser's round hand (Pinyon, weighted), not a printer's type.
const P1 = [], P1W = [];                                         // P1W: items the hand writes (the rest letter by themselves)
const fitSize = (text, fam, size, maxW) => { MEAS.font = `${size}px "${fam}"`; return Math.min(size, size * maxW / MEAS.measureText(text).width); };
P1.push(inkItem({ text: [{ t: 'IN CONGRESS, ', family: HAND.sc, size: 44 }, { t: 'July 4, 1776.', family: HAND.copper, size: 52 }], family: HAND.copper, size: 48, x: PW / 2, y: 140, align: 'center', color: INK.black, weight: 0.9, t0: -3, t1: -2.9 }));
P1.push(inkItem({ text: 'The unanimous Declaration', family: HAND.copper, size: fitSize('The unanimous Declaration', HAND.copper, 108, 900), x: PW / 2, y: 250, align: 'center', color: INK.black, weight: 2.4, t0: -3, t1: -2.9 }));
P1.push(inkItem({ text: 'of the thirteen united States of America,', family: HAND.copper, size: fitSize('of the thirteen united States of America,', HAND.copper, 60, 860), x: PW / 2, y: 330, align: 'center', color: INK.iron, weight: 1.1, t0: -3, t1: -2.9 }));
const FIRST = inkItem({ text: 'When in the Course of human events,', family: HAND.copper, size: 68, x: 76, y: 430, color: INK.black, t0: -0.3, t1: 2.2, blot: 1, weight: 0.5 });
P1.push(FIRST); P1W.push(FIRST);
const PREAMBLE = 'it becomes neceſsary for one people to diſsolve the political bands which have connected them with another, and to aſsume among the powers of the earth, the separate and equal station to which the Laws of Nature and of Nature’s God entitle them, a decent respect to the opinions of mankind requires that they should declare the causes which impel them to the separation.';
// never 'all men are created equal' (r1776 §6 #5): the second paragraph is shown from its turn, which the 2024 sheet echoes
const TRAIN = '…But when a long train of abuses and usurpations, pursuing invariably the same Object evinces a design to reduce them under absolute Despotism, it is their right, it is their duty, to throw off such Government, and to provide new Guards for their future security.';
let P1_TEXT_END;
{ const n0 = P1.length, size = 19, lh = 25, a = wrap(PREAMBLE, HAND.copper, size, 930);
  let y = block(P1, a, { x: 80, y: 480, lh, size, b0: 2.25, b1: 6.2, soft: 1.25, lead: 0.34, alpha: 0.82 });
  const t = wrap(TRAIN, HAND.copper, size, 910);
  y = block(P1, t, { x: 80, y: y + 10, lh, size, b0: 6.3, b1: 8.9, indent: 34, soft: 1.25, lead: 0.34, alpha: 0.82 });
  P1_TEXT_END = y; for (let i = n0; i < P1.length; i++) if (!P1[i].pop) P1W.push(P1[i]); }
// the signers: Hancock large on BROKE AN EMPIRE, then the 56 in the parchment's six state columns (south left, north right).
// The camera tracks two columns at a time (11-15.5); in each column the hand signs the head name and the rest follow down it.
const HANCOCK = inkItem({ text: 'John Hancock', family: HAND.delafield, size: 128, x: 470, y: P1_TEXT_END + 128, align: 'center', color: INK.black, weight: 1.4,
  t0: 9.0, t1: 10.9, paraph: { w: 40, h: 96, draw: paraphHancock } });
P1.push(HANCOCK); P1W.push(HANCOCK);
const COLS = [                                                     // as signed; ^ raises the abbreviation's letters [VERIFY-NARA]
  [['Button Gwinnett', 'Lyman Hall', 'G^eo Walton']],
  [['W^m Hooper', 'Joseph Hewes', 'John Penn'], ['Edward Rutledge', 'Tho^s Heyward Jun^r.', 'Thomas Lynch Jun^r.', 'Arthur Middleton']],
  [['Samuel Chase', 'W^m. Paca', 'Tho^s. Stone', 'Charles Carroll of Carrollton'], ['George Wythe', 'Richard Henry Lee', 'Th Jefferson', 'Benj^a. Harrison', 'Tho^s. Nelson j^r.', 'Francis Lightfoot Lee', 'Carter Braxton']],
  [['Rob^t Morris', 'Benjamin Rush', 'Benj^a. Franklin', 'John Morton', 'G^eo Clymer', 'J^as. Smith', 'G^eo. Taylor', 'James Wilson', 'G^eo. Ross'], ['Caesar Rodney', 'G^eo Read', 'Tho M:Kean']],
  [['W^m. Floyd', 'Phil. Livingston', 'Fran^s. Lewis', 'Lewis Morris'], ['Rich^d. Stockton', 'J^no Witherspoon', 'Fra^s. Hopkinson', 'John Hart', 'Abr^a Clark']],
  [['Josiah Bartlett', 'W^m. Whipple'], ['Sam^l Adams', 'John Adams', 'Rob^t Treat Paine', 'Elbridge Gerry'], ['Step. Hopkins', 'William Ellery'],
    ['Roger Sherman', 'Sam^el Huntington', 'W^m. Williams', 'Oliver Wolcott'], ['Matthew Thornton']],
];
// period hands only (no print or upright-roman faces); each signer keeps one hand, chosen from the name
const HANDS1 = [[HAND.meddon, 0.78], [HAND.haviland, 1.2], [HAND.copper, 0.98], [HAND.herr, 1.3], [HAND.delafield, 1.22], [HAND.italianno, 1.15], [HAND.tangerine, 1.2], [HAND.imperial, 1.02]];
const SIGNERS1 = [], COLWIN = c => { const p = Math.floor(c / 2), a = 11.05 + p * 1.5 + (c % 2) * 0.62; return [a, a + 0.86]; };
{ const r = rng(1776), top = HANCOCK.top + HANCOCK.ch / PS - 10, bottom = 1850, x0 = 36, cw = (PW - 72) / 6;
  COLS.forEach((groups, c) => {
    const n = groups.reduce((a, g) => a + g.length, 0) + (groups.length - 1) * 0.35;
    const y0 = c === 0 ? top + 190 : c >= 4 ? top - 110 : top;     // Georgia sits low, as on the parchment; the north starts beside Hancock
    const lh = Math.min(66, (bottom - y0) / n), [w0, w1] = COLWIN(c);
    let y = y0 + lh * 0.8, i = 0;
    groups.forEach((grp, gi) => {
      if (gi) y += lh * 0.35;
      grp.forEach(name => {
        let hsh = 0; for (const ch of name) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
        const [fam, kk] = HANDS1[hsh % HANDS1.length];
        MEAS.font = `${34 * kk}px "${fam}"`; const wd = MEAS.measureText(name.replace(/\^/g, '')).width;
        const size = Math.min(36 * kk, 34 * kk * (cw - 8) / wd);
        const lead = i === 0, st = lead ? w0 : w0 + 0.3 + (i / n) * (w1 - w0 - 0.3), d = lead ? 0.3 : 0.16;
        const it = inkItem({ text: name, family: fam, size, x: x0 + c * cw + cw / 2 + (r() - 0.5) * 6, y: y + (r() - 0.5) * 5, align: 'center',
          color: [INK.iron, INK.brown, INK.black][Math.floor(r() * 3)], rot: (r() - 0.5) * 0.04, weight: r() < 0.5 ? 0.6 : 0.2,
          paraph: r() < 0.3 ? { w: 0, h: 22, draw: paraphSwash(c * 50 + i) } : null, t0: st, t1: st + d });
        const L = U(it); it.left += clamp(L.l, 22, PW - 22 - (L.r - L.l)) - L.l;   // inside the sheet
        it.col = c; P1.push(it); SIGNERS1.push(it); if (lead) P1W.push(it); y += lh; i++;
      });
    });
  });
}

// ================================================================ SHEET 2: Chicago, July 21, 2024 (the Party Declaration's own words)
const P2 = [], P2W = [];
const push2 = (it, w = true) => { P2.push(it); if (w) P2W.push(it); return it; };
push2(inkItem({ text: 'Chicago, July 21, 2024.', family: HAND.copper, size: fitSize('Chicago, July 21, 2024.', HAND.copper, 76, 700), x: PW / 2, y: 205, align: 'center', color: INK.blue, t0: 18.05, t1: 19.55, blot: 1, weight: 0.4 }));
push2(inkItem({ text: 'THE PARTY DECLARATION', family: HAND.sc, size: fitSize('THE PARTY DECLARATION', HAND.sc, 46, 640), x: PW / 2, y: 284, align: 'center', color: INK.blue, t0: 19.6, t1: 20.35 }));
push2(inkItem({ text: 'of the American Communist Party', family: HAND.fell, style: 'italic', size: 38, x: PW / 2, y: 334, align: 'center', color: INK.blue, t0: 20.4, t1: 20.95 }));
const ECHO = push2(inkItem({ text: '…when in the course of events,', family: HAND.copper, size: fitSize('…when in the course of events,', HAND.copper, 78, 900), x: 76, y: 440, color: INK.blue, t0: 21.0, t1: 22.6, blot: 1, weight: 0.3 }));
// DECL's own words [V-log; check against acp.us/declaration]: the long train, one history, the Plenary Committee's
// declaration; then the ACP Constitution's 1776 line (the client's 'constitution', r1776 §2.3). Never DECL's CPUSA items.
let P2_TEXT_END;
{ const n0 = P2.length, ink = { ink0: INK.blue, ink1: '#2c2a38' };
  let y = block(P2, wrap('…a long train of abuse, corruption and usurpations…', HAND.copper, 58, 900), { x: 78, y: 522, lh: 68, size: 58, b0: 22.7, b1: 24.6, ...ink });
  y = block(P2, wrap('…a given country can only have one history.', HAND.copper, 58, 900), { x: 78, y: y + 14, lh: 68, size: 58, b0: 24.7, b1: 25.95, indent: 36, ...ink });
  y = block(P2, wrap('Therefore, the Plenary Committee of the American Communist Party, now assembled in Chicago, Illinois, solemnly declare…', HAND.copper, 31, 920),
    { x: 78, y: y + 10, lh: 38, size: 31, b0: 26.0, b1: 26.6, lead: 0.3, ...ink });
  y = block(P2, wrap('…the American revolutionary tradition beginning in 1776…', HAND.copper, 31, 920), { x: 78, y: y + 6, lh: 38, size: 31, b0: 26.62, b1: 26.95, lead: 0.4, ...ink });
  P2_TEXT_END = y - 16; for (let i = n0; i < P2.length; i++) if (!P2[i].pop) P2W.push(P2[i]); }
const UNDER = [];                                                // PASS THE PEN: the pen goes back and underscores 'one history.'
{ const hi = P2.findIndex(i => i.text === 'history.'), one = P2[hi - 1];
  if (hi > 0 && one.text === 'one') { const a = U(one), c = U(P2[hi]); UNDER.push({ x0: a.l - 4, x1: c.r + 6, y: c.base + 14, b0: 27.0, b1: 27.7, seed: 11 }); } }
// THE RED SIGNATORIES (the client's idea; beats 28-32): names in period hands, red ink, one after another.
// Order per research/scripts_final/unfinished.json and LINE_BIBLE §6.4, with two decisions of this pass:
//  - Wm. D. Haywood (Big Bill: IWW, then the Communist Party, died in Moscow) replaces Harry Haywood, whose later career ran through the 1970s New Communist Movement that grew out of the New Left (audit, 27 Sep).
//  - 'Benj. J. Davis, Jr.': without the Jr. the name is his father's, a Republican publisher in Georgia.
// Two period hands only, both with an unambiguous capital I and J (Pinyon's copperplate for the four oldest hands of the
// block, Tangerine's bold italic hand for the rest). Even sizes, so the block never reads as a ranking; Foster a touch the
// largest of the Americans. The four classics sign one by one with the pen; the Americans follow in two bursts of four,
// the pen signing the first of each. Names only, never facsimiles; no caption, frame or label.
const REDF = { copper: [HAND.copper, '', 1], tang: [HAND.tangerine, '700', 1.36] };   // [face, weight, size factor]
const REDS = [
  // [name, hand, size, row, column]
  ['Karl Marx', 'copper', 50, 0, 0], ['Frederick Engels', 'copper', 50, 0, 1],
  ['N. Lenin', 'tang', 50, 1, 0], ['J. Stalin', 'tang', 50, 1, 1],
  ['John Reed', 'copper', 44, 2, 0], ['C. E. Ruthenberg', 'tang', 44, 2, 1],
  ['Wm. Z. Foster', 'tang', 48, 3, 0], ['Ella Reeve Bloor', 'copper', 44, 3, 1],
  ['Elizabeth Gurley Flynn', 'tang', 44, 4, 0], ['Wm. D. Haywood', 'tang', 44, 4, 1],
  ['Benj. J. Davis, Jr.', 'tang', 44, 5, 0], ['W. E. B. Du Bois', 'tang', 44, 5, 1],
];
const RED_ROWS = Array.from({ length: 6 }, (_, k) => P2_TEXT_END + 70 + k * 56), RED_COLS = [300, 770];
const RED_T = [], RED_PEN = new Set();
REDS.forEach((_, i) => { if (i < 4) { RED_T.push([28.05 + i * 0.44, 28.05 + i * 0.44 + 0.4]); RED_PEN.add(i); return; }
  const k = i - 4, burst = k >> 2, j = k & 3, b = 29.85 + burst * 1.05 + j * 0.24; RED_T.push([b, b + 0.46]); if (!j) RED_PEN.add(i); });
const REDSIG = REDS.map(([name, hand, size, row, col], i) => {
  const [fam, fw, kz] = REDF[hand], r = rng(90 + i);
  const it = inkItem({ text: name, family: fam, fw, size: size * kz, x: RED_COLS[col] + (r() - 0.5) * 24, y: RED_ROWS[row] + (r() - 0.5) * 6, align: 'center', color: INK.red,
    weight: hand === 'tang' ? 0.5 : 0.8, rot: (r() - 0.55) * 0.035, t0: RED_T[i][0], t1: RED_T[i][1], blot: 1, paraph: r() < 0.4 ? { w: 0, h: 20, draw: paraphSwash(300 + i) } : null });
  const L = U(it); it.left += clamp(L.l, 70, PW - 70 - (L.r - L.l)) - L.l; it.redInk = true;
  return push2(it, RED_PEN.has(i));
});
const RED_END = Math.max(...REDSIG.map(it => U(it).b)) - 14;
// the wall: Small Farmer, Machinist, Sailor first (the 1776 roll in today's trades), then faster and faster
const TRADES = ['Small Farmer', 'Machinist', 'Sailor', 'Rail Worker', 'Trucker', 'Teamster', 'Nurse', 'Welder', 'Lineman', 'Farmer', 'Electrician',
  'Steelworker', 'Carpenter', 'Mechanic', 'Teacher', 'Pipefitter', 'Autoworker', 'Bricklayer', 'Millwright', 'Ironworker', 'Plumber',
  'Miner', 'Line Cook', 'Warehouse Worker', 'Boilermaker', 'Roofer', 'Driver', 'Engineer', 'Printer', 'Baker', 'Surveyor', 'Seamstress', 'Operator',
  'Machinist', 'Nurse', 'Rail Worker', 'Coder', 'Farmer', 'Welder', 'Trucker', 'Teamster', 'Lineman', 'Electrician', 'Mechanic', 'Steelworker',
  'Carpenter', 'Janitor', 'Mason', 'Glazier', 'Tool & Die Maker', 'Fisherman', 'Rancher'];
const SIGFONTS = [[HAND.aurore, 0.95], [HAND.delafield, 1.25], [HAND.apple, 0.62], [HAND.vibes, 0.95], [HAND.herr, 1.25], [HAND.copper, 0.9]];
const SIGN_T = []; { let b = 32.15; for (let i = 0; i < TRADES.length; i++) { SIGN_T.push(b); const k = b - 32; b += k < 3 ? 0.9 : k < 6 ? 0.5 : Math.max(0.08, 0.3 - (k - 6) * 0.03); } }
const HAND_WALL = 3;                                             // the pen signs the first three; then the wall outruns one hand
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const KEEP = P2.map(it => { const L = U(it); return [L.l - 8, L.t + (it.ch / PS) * 0.18, L.r + 8, L.b - (it.ch / PS) * 0.2]; });
const SIGS = [];
{ const r = rng(2024), placed = [], z0 = RED_END + 20;
  const slots = [[300, z0 + 70], [770, z0 + 80], [520, z0 + 190]];
  const boxOf = (trade, fam, size, cx, cy, rot, par) => {
    MEAS.font = `${size}px "${fam}"`; const m = MEAS.measureText(trade), w = m.width, l = clamp(cx - w / 2, 40, PW - 40 - w), tilt = Math.abs(Math.sin(rot)) * (w + size * 0.5);
    return [l - 6, cy - m.actualBoundingBoxAscent - 4 - (rot < 0 ? tilt : 0), l + w + 6, cy + Math.max(m.actualBoundingBoxDescent, par ? 30 : 0) + 4 + (rot > 0 ? tilt : 0)];
  };
  const ok = bx => bx[1] > z0 && bx[3] < 1872 && !KEEP.some(k => hit(bx, k));
  TRADES.forEach((trade, i) => {
    const [fam, k] = SIGFONTS[(i * 7 + 3) % SIGFONTS.length], t = SIGN_T[i];
    let size = (i < slots.length ? 70 : t < 38 ? lerp(40, 54, r()) : lerp(30, 44, r())) * k, x, y, box = null;
    const rot = (r() - 0.6) * 0.07, par = r() < 0.5, wt = [0, 0.8, 1.6, 2.4][Math.floor(r() * 4)];
    if (i < slots.length) { [x, y] = slots[i]; box = boxOf(trade, fam, size, x, y, rot, par); if (!ok(box) || placed.some(p => hit(p, box))) box = null; }
    if (!box) {
      let best = null, bs = -1e9;
      for (let tries = 0; tries < 240 && !(best && tries >= 80); tries++) {
        if (tries && tries % 80 === 0) size *= 0.85;
        const cx = 150 + r() * (PW - 300), cy = z0 + 20 + r() * (1860 - z0 - 20), bx = boxOf(trade, fam, size, cx, cy, rot, par);
        if (!ok(bx)) continue;
        const clash = placed.filter(p => hit(p, bx)).length;
        if ((t < 40 && clash) || clash > 1 || placed.slice(0, 10).some(p => hit(p, bx))) continue;   // the first ten hands stay clear
        let d = 1e9; for (const p of placed) d = Math.min(d, Math.hypot(((p[0] + p[2]) - (bx[0] + bx[2])) * 0.3, ((p[1] + p[3]) - (bx[1] + bx[3])) * 0.5));
        const sc = Math.min(d, 400) - clash * 200;
        if (sc > bs) { bs = sc; best = [cx, cy, bx]; }
      }
      for (let tries = 0; !best && tries < 400; tries++) { size *= 0.995; const cx = 150 + r() * (PW - 300), cy = z0 + 30 + r() * (1860 - z0 - 30), bx = boxOf(trade, fam, size, cx, cy, rot, par); if (ok(bx)) best = [cx, cy, bx]; }
      if (!best) return;
      [x, y, box] = best;
    }
    placed.push(box);
    const it = inkItem({ text: trade, family: fam, size, x, y, align: 'center', color: [INK.black, INK.blue, INK.iron, '#1b1b2a'][i % 4],
      weight: wt * size / 74, rot, t0: t, t1: t + (i < slots.length ? 0.75 : 0.42), paraph: par ? { w: 0, h: 28, draw: paraphSwash(i * 13 + 5) } : null, red: true });
    it.left = box[0] + 6 - it.ox / PS; if (rot < 0) it.top += Math.sin(-rot) * it.ox / PS; it.ry = y;
    SIGS.push(it); if (i < HAND_WALL) P2W.push(it);
  });
}
// the pen's path on sheet 2 includes the underscore
const UNDER_ITEMS = UNDER.map(L => ({ under: L, t0: L.b0, t1: L.b1 }));

// ================================================================ wax seal: a height field, ray-shaded once (pressed + unpressed)
// The matrix is the ACP's own mark as Art. III sets it (the hammer, sickle and gear at its 45° tilt, the four stripes, ACP),
// baked at that fixed angle; only the wax outline and thickness vary from seal to seal. The rim reads 1776 · 2024 ·.
const LOGO = await loadImage('../assets/acp_logo.png');
function bakeSeal(pressed, seed = 1, px = 720, matrix = null) {
  const hm = document.createElement('canvas'); hm.width = hm.height = px; const g = hm.getContext('2d'), R = px / 2;
  g.fillStyle = '#000'; g.fillRect(0, 0, px, px);
  if (pressed && matrix) { g.save(); g.translate(R, R); matrix(g, R, px); g.restore(); }
  else if (pressed) {                                            // the matrix (raised = white)
    g.save(); g.translate(R, R);
    g.strokeStyle = '#fff'; g.lineWidth = px * 0.014; g.beginPath(); g.arc(0, 0, R * 0.74, 0, 7); g.stroke();
    g.lineWidth = px * 0.007; g.beginPath(); g.arc(0, 0, R * 0.53, 0, 7); g.stroke();
    g.fillStyle = '#fff'; g.font = `${Math.round(px * 0.064)}px "IM Fell English SC"`; g.textAlign = 'center';
    const rim = '1776 · 2024 · 1776 · 2024 ·'.split(' '), step = Math.PI * 2 / rim.length;   // reads clockwise from the top
    rim.forEach((w, i) => { g.save(); g.rotate(i * step); g.translate(0, -R * 0.6); g.fillText(w, 0, px * 0.024); g.restore(); });
    // the logo: its red and black parts become relief, its pale outline does not
    const lw = R * 0.98, lh = LOGO.height * lw / LOGO.width, t = document.createElement('canvas'); t.width = LOGO.width; t.height = LOGO.height;
    const gt = t.getContext('2d'); gt.drawImage(LOGO, 0, 0); const id = gt.getImageData(0, 0, t.width, t.height), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const lum = (d[i] + d[i + 1] + d[i + 2]) / 3, sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      const on = d[i + 3] > 128 && (sat > 70 || lum < 90) ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = on; }
    gt.putImageData(id, 0, 0);
    g.drawImage(t, -lw / 2, -lh / 2 - R * 0.02, lw, lh);
    g.restore();
  }
  const blur = document.createElement('canvas'); blur.width = blur.height = px; const gb = blur.getContext('2d');
  gb.filter = `blur(${px * 0.0035}px)`; gb.drawImage(hm, 0, 0);
  const gc = document.createElement('canvas'); gc.width = gc.height = px;
  const gl = gc.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: true });
  const pr = glProgram(gl, `#version 300 es
precision highp float; uniform sampler2D uH; uniform float uPress, uSeed; out vec4 o;
float h31(vec2 p){p=fract(p*vec2(.1031,.103));p+=dot(p,p.yx+33.3);return fract((p.x+p.y)*p.x);}
float vn(vec2 x){vec2 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(h31(i),h31(i+vec2(1,0)),f.x),mix(h31(i+vec2(0,1)),h31(i+vec2(1,1)),f.x),f.y);}
float ht(vec2 uv){vec2 p=uv*2.-1.;float a=atan(p.y,p.x),r=length(p);
  vec2 cs=vec2(cos(a),sin(a)); float edge=.86+.03*sin(a*5.+uSeed)+.022*sin(a*9.+2.*uSeed)+.08*(vn(cs*2.2+uSeed*3.)-.5)+.035*(vn(cs*6.+uSeed)-.5);
  float thick=.8+.25*fract(uSeed*.37);
  float dome=sqrt(max(0.,1.-pow(r/edge,2.)))*.6*thick+smoothstep(edge,edge-.06,r)*.3;
  float h=dome*.9;
  if(uPress>.5){float pool=smoothstep(.8,.62,r); h=mix(h,.6*thick+.012*vn(p*5.),pool*.92)+pool*.004*vn(p*25.);
    h+=smoothstep(.84,.76,r)*smoothstep(.6,.72,r)*.13;                        // the squeezed-out lip
    h+=.085*texture(uH,uv).r*pool; }
  return h*smoothstep(edge+.01,edge-.02,r);}
float lipA(vec2 uv){vec2 p=uv*2.-1.;float r=length(p);return smoothstep(.84,.77,r)*smoothstep(.6,.73,r);}
void main(){vec2 uv=gl_FragCoord.xy/vec2(textureSize(uH,0));float e=1./float(textureSize(uH,0).x);
  float h=ht(uv); if(h<.003){o=vec4(0);return;}
  vec3 n=normalize(vec3(ht(uv-vec2(e,0))-ht(uv+vec2(e,0)),ht(uv-vec2(0,e))-ht(uv+vec2(0,e)),5.*e));
  vec3 L=normalize(vec3(-.55,.5,.62)),V=vec3(0,0,1),Hh=normalize(L+V);
  float d=max(dot(n,L),0.); float nh=max(dot(n,Hh),0.); float s=pow(nh,90.)*1.6+pow(nh,14.)*.14;
  vec3 alb=vec3(.23,.012,.02)*(.86+.28*vn(uv*18.));                              // oxblood, a little uneven
  alb=mix(alb,vec3(.42,.05,.06),.55*lipA(uv)*uPress);                           // thin wax at the lip runs lighter
  vec3 c=alb*(.22+1.1*d)+vec3(1.,.86,.72)*s+alb*vec3(1.,.35,.3)*.35*(1.-d);   // light gets under the skin of the wax
  o=vec4(pow(c,vec3(1./1.6)),smoothstep(.0,.02,h));}`);
  gl.useProgram(pr);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blur);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1f(gl.getUniformLocation(pr, 'uPress'), pressed ? 1 : 0); gl.uniform1f(gl.getUniformLocation(pr, 'uSeed'), seed);
  gl.viewport(0, 0, px, px); gl.drawArrays(gl.TRIANGLES, 0, 3);
  const out = document.createElement('canvas'); out.width = out.height = px; const go = out.getContext('2d');
  go.save(); go.translate(0, px); go.scale(1, -1); go.drawImage(gc, 0, 0); go.restore();   // GL rows are bottom-up
  return out;
}
function glProgram(gl, fs) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2(gl_VertexID==1?3.:-1.,gl_VertexID==2?3.:-1.);gl_Position=vec4(p,0,1);}'));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
// the Crown's seal on the King's proclamation (the one that snaps at 9): a crown over GR, a legend on the rim
const CROWN_SEAL = bakeSeal(true, 8.1, 720, (g, R, px) => {
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = px * 0.012; g.beginPath(); g.arc(0, 0, R * 0.74, 0, 7); g.stroke();
  g.lineWidth = px * 0.006; g.beginPath(); g.arc(0, 0, R * 0.56, 0, 7); g.stroke();
  g.font = `${Math.round(px * 0.05)}px "IM Fell English SC"`; g.textAlign = 'center';
  const leg = 'GEORGIUS · III · D · G · MAG · BRI · REX ·'.split(' '), st = Math.PI * 2 / leg.length;
  leg.forEach((w, i) => { g.save(); g.rotate(i * st); g.translate(0, -R * 0.62); g.fillText(w, 0, px * 0.02); g.restore(); });
  const s = R * 0.42; g.beginPath(); g.moveTo(-s, s * 0.15); g.lineTo(-s * 1.05, -s * 0.55); g.lineTo(-s * 0.55, -s * 0.2); g.lineTo(-s * 0.3, -s * 0.8);   // the crown
  g.lineTo(0, -s * 0.3); g.lineTo(s * 0.3, -s * 0.8); g.lineTo(s * 0.55, -s * 0.2); g.lineTo(s * 1.05, -s * 0.55); g.lineTo(s, s * 0.15); g.closePath(); g.fill();
  for (const x of [-s * 1.05, -s * 0.3, s * 0.3, s * 1.05]) { g.beginPath(); g.arc(x, x === -s * 1.05 || x === s * 1.05 ? -s * 0.6 : -s * 0.86, s * 0.1, 0, 7); g.fill(); }
  g.beginPath(); g.moveTo(0, -s * 0.95); g.lineTo(0, -s * 1.25); g.moveTo(-s * 0.12, -s * 1.12); g.lineTo(s * 0.12, -s * 1.12); g.lineWidth = px * 0.012; g.stroke();
  g.fillRect(-s, s * 0.22, s * 2, s * 0.14);
  g.font = `${Math.round(px * 0.19)}px "IM Fell English SC"`; g.fillText('GR', 0, s * 1.05);
});
// the brass matrix (the ACP mark cut in reverse), seen from above: knurled rim, turned boss, a turned walnut knob
const MATRIX = (() => { const c = document.createElement('canvas'); c.width = c.height = 640; const g = c.getContext('2d'), R = 300, o = 320;
  const br = g.createRadialGradient(o - 90, o - 110, 20, o, o, R); br.addColorStop(0, '#f6dc8c'); br.addColorStop(0.45, '#c39a45'); br.addColorStop(0.85, '#7a5520'); br.addColorStop(1, '#4a3010');
  g.fillStyle = br; g.beginPath(); g.arc(o, o, R, 0, 7); g.fill();
  g.strokeStyle = 'rgba(40,24,6,0.65)'; g.lineWidth = 3;
  for (let i = 0; i < 180; i++) { const a = i / 180 * Math.PI * 2; g.beginPath(); g.moveTo(o + Math.cos(a) * (R - 26), o + Math.sin(a) * (R - 26)); g.lineTo(o + Math.cos(a) * R, o + Math.sin(a) * R); g.stroke(); }
  for (let k = 0; k < 14; k++) { g.strokeStyle = k % 2 ? 'rgba(255,236,170,0.35)' : 'rgba(60,36,8,0.35)'; g.lineWidth = 2.5; g.beginPath(); g.arc(o, o, 210 - k * 6, 0, 7); g.stroke(); }
  // no dark knob (v9 review: it read as an eye): a brass hex boss, lighter than the plate, and the maker's legend engraved
  const hx = g.createLinearGradient(o - 90, o - 90, o + 90, o + 90); hx.addColorStop(0, '#fbe7a4'); hx.addColorStop(0.5, '#d4ab55'); hx.addColorStop(1, '#8a6220');
  g.fillStyle = hx; g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; g.lineTo(o + Math.cos(a) * 92, o + Math.sin(a) * 92); } g.closePath(); g.fill();
  g.strokeStyle = 'rgba(70,44,10,0.7)'; g.lineWidth = 3; g.stroke();
  g.fillStyle = 'rgba(70,44,10,0.75)'; g.font = '30px "IM Fell English SC"'; g.textAlign = 'center';
  'A · C · P · 1776 · 2024 ·'.split(' ').forEach((w, i, A) => { g.save(); g.translate(o, o); g.rotate(i / A.length * Math.PI * 2); g.fillText(w, 0, -236); g.restore(); });
  return c; })();
// the red that bleeds round the central seal into the fibres (the only red on the paper besides ink and wax)
const BLEED = (() => { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'), r = rng(505);
  for (let i = 0; i < 260; i++) { const a = r() * Math.PI * 2, d = 175 + r() ** 2 * 70, x = 256 + Math.cos(a) * d, y = 256 + Math.sin(a) * d, rr = 6 + r() * 26;
    const gg = g.createRadialGradient(x, y, 0, x, y, rr); gg.addColorStop(0, `rgba(150,20,28,${0.18 + r() * 0.2})`); gg.addColorStop(1, 'rgba(150,20,28,0)'); g.fillStyle = gg; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  return c; })();
const SEALV = [1.3, 2.9, 5.2].map(sd => ({ pressed: bakeSeal(true, sd), blob: bakeSeal(false, sd + 0.7) }));
const SEALSH = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');   // the seal's soft shadow, baked once
  g.filter = 'blur(14px)'; g.fillStyle = 'rgba(20,2,2,0.62)'; g.beginPath(); g.ellipse(128, 128, 92, 90, 0, 0, 7); g.fill(); return c; })();
const RIBC = new Map();
function ribbon(g, cx, cy, ang, len, w, u) {                  // a cream silk ribbon under a seal: two tails, soft folds, a sheen
  if (u <= 0) return;
  if (u >= 1) { const key = `${cx},${cy}`; if (!RIBC.has(key)) { const S = len + w + 40, c = document.createElement('canvas'); c.width = c.height = Math.ceil(S * 2 * PS);
      const gc = c.getContext('2d'); gc.setTransform(PS, 0, 0, PS, S * PS, S * PS); ribbonDraw(gc, 0, 0, ang, len, w, 1, true); RIBC.set(key, { c, S }); }
    const { c, S } = RIBC.get(key); g.drawImage(c, cx - S, cy - S, S * 2, S * 2); return; }
  ribbonDraw(g, cx, cy, ang, len, w, u, false);
}
function ribbonDraw(g, cx, cy, ang, len, w, u, blur) {
  g.save(); g.translate(cx, cy);
  for (const side of [-1, 1]) {
    const a = ang + side * 0.32, L = len * ease.outCubic(u), N = 24;
    g.beginPath();
    for (let i = 0; i <= N; i++) { const t = i / N, x = Math.cos(a) * L * t, y = Math.sin(a) * L * t + Math.sin(t * 5 + side) * 6, wd = w * (1 - 0.1 * t);
      const nx = -Math.sin(a), ny = Math.cos(a); if (!i) g.moveTo(x + nx * wd / 2, y + ny * wd / 2); else g.lineTo(x + nx * wd / 2, y + ny * wd / 2); }
    for (let i = N; i >= 0; i--) { const t = i / N, x = Math.cos(a) * L * t, y = Math.sin(a) * L * t + Math.sin(t * 5 + side) * 6, wd = w * (1 - 0.1 * t);
      const nx = -Math.sin(a), ny = Math.cos(a); g.lineTo(x - nx * wd / 2 + (t > 0.97 ? side * wd * 0.35 : 0), y - ny * wd / 2); }
    g.closePath();
    const gr = g.createLinearGradient(-Math.sin(a) * w / 2, Math.cos(a) * w / 2, Math.sin(a) * w / 2, -Math.cos(a) * w / 2);
    gr.addColorStop(0, '#b9a684'); gr.addColorStop(0.35, '#efe3c6'); gr.addColorStop(0.55, '#fff6df'); gr.addColorStop(1, '#a8926c');
    if (blur) { g.shadowColor = 'rgba(30,4,2,0.55)'; g.shadowBlur = 10 * PS; g.shadowOffsetX = 5 * PS; g.shadowOffsetY = 7 * PS; }
    g.fillStyle = gr; g.fill(); g.shadowColor = 'transparent';
  }
  g.restore();
}
function waxSeal(g, cx, cy, rad, b, tp, v = 0, rot = 0, d0 = tp - 0.6) {   // on a sheet (units): the drop, the press on tp (a beat)
  const u = (b - d0) / 0.6; if (u <= 0) return;
  const drop = ease.outBack(clamp(u)), press = ease.outExpo(clamp((b - tp) / 0.25)), R = rad * drop * lerp(1, 1.07, press), S = SEALV[v % SEALV.length];
  g.save(); g.translate(cx, cy); g.rotate(rot);
  g.drawImage(SEALSH, rad * 0.07 - R * 1.28, rad * 0.09 - R * 1.28, R * 2.56, R * 2.56);
  g.globalAlpha = 1 - press; g.drawImage(S.blob, -R, -R, R * 2, R * 2);
  g.globalAlpha = press; g.drawImage(S.pressed, -R, -R, R * 2, R * 2); g.globalAlpha = 1;
  g.restore();
}

// ================================================================ the pen: one pure function of the beat
// items the hand writes, in order, per sheet; returns { sheet, x, y (page units), lift 0..1, away 0..1 }
const PATH1 = P1W.slice().sort((a, b) => a.t0 - b.t0);
const PATH2 = [...P2W, ...UNDER_ITEMS].sort((a, b) => a.t0 - b.t0);
const tipOf = (it, b) => it.under ? (() => { const L = it.under, u = ease.inOutCubic(clamp((b - L.b0) / (L.b1 - L.b0))); return [lerp(L.x0, L.x1, u), L.y - u * 5]; })() : nibOf(it, b);
const startOf = it => it.under ? [it.under.x0, it.under.y] : toPage(it, 0, it.nibY[0]);
function penOn(path, b, rest) {
  let prev = null, next = null;
  for (const it of path) { if (it.t0 <= b) prev = it; else { next = it; break; } }
  if (!prev) { const s = startOf(next); const u = clamp((next.t0 - b) / 1.2); return { x: s[0] + u * 380, y: s[1] + u * 520, lift: u, away: u }; }
  if (b < prev.t1) { const [x, y] = tipOf(prev, b); return { x, y, lift: 0, away: 0 }; }
  const e = tipOf(prev, prev.t1);
  if (next && next.t0 - prev.t1 < 1.4) {                          // travel to the next stroke, lifted
    const s = startOf(next), u = clamp((b - prev.t1) / (next.t0 - prev.t1)), k = ease.inOutCubic(u);
    return { x: lerp(e[0], s[0], k), y: lerp(e[1], s[1], k), lift: Math.sin(Math.PI * u) * clamp((next.t0 - prev.t1) * 3), away: 0 };
  }
  const u = clamp((b - prev.t1) / 1.1), k = ease.inOutCubic(u);   // done: lift and withdraw toward the writer
  return { x: e[0] + k * (rest ? rest[0] : 420), y: e[1] + k * (rest ? rest[1] : 620), lift: clamp(u * 3), away: k };
}
function pen(b) {
  if (b < 16) return { sheet: 1, ...penOn(PATH1, b) };
  return { sheet: 2, ...penOn(PATH2, b) };
}

// ================================================================ drawing the sheets (2D, page units)
const PROF = location.search.includes('prof');
const S1 = sheetCanvas(), g1 = S1.getContext('2d'), S2 = sheetCanvas(), g2 = S2.getContext('2d');
g1.setTransform(PS, 0, 0, PS, 0, 0); g2.setTransform(PS, 0, 0, PS, 0, 0);
function sheet1(b) {
  g1.save(); g1.setTransform(1, 0, 0, 1, 0, 0); g1.clearRect(0, 0, TW, TH); g1.drawImage(PAPER1, 0, 0); g1.restore();
  drawItems(g1, P1, b);
}
// THE RED (40-48): the ink turns red, and the red wicks out of the workers' strokes into the fibres, bottom rows first,
// with a soft mottled front and a darker tide line (capillary, never a pool, never a drip); at 48 it takes the whole sheet
// from the foot up in under a beat. An arrival-time field at 5 units a cell; a brick-to-crimson tint multiplied into the
// paper, so every fibre, stain and fold still shows through.
const RW = 216, RH = 384, RC = PW / RW;
function vnoise2(seed) { const r = rng(seed), G = 64, T = Float32Array.from({ length: G * G }, () => r());
  const at = (i, j) => T[((j % G + G) % G) * G + ((i % G + G) % G)];
  return (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(at(i, j), at(i + 1, j), ux), lerp(at(i, j + 1), at(i + 1, j + 1), ux), uy); }; }
const NZA = vnoise2(401), NZB = vnoise2(402);
const fbm2 = (x, y) => NZA(x, y) * 0.5 + NZA(x * 2.1 + 5, y * 2.1 + 3) * 0.25 + NZB(x * 4.3, y * 4.3) * 0.15 + NZB(x * 9.1 + 7, y * 9.1) * 0.1;
const RTF = new Float32Array(RW * RH);
{ // the ink of the wall at low resolution: every inked cell is a source, from the bottom rows up (40 -> 42.5)
  const ic = document.createElement('canvas'); ic.width = RW; ic.height = RH; const gi = ic.getContext('2d');
  gi.setTransform(1 / RC, 0, 0, 1 / RC, 0, 0); drawItems(gi, SIGS, 99);
  const inkA = gi.getImageData(0, 0, RW, RH).data, N = RW * RH, heap = [], push = (t, i) => { heap.push([t, i]); let k = heap.length - 1;
    while (k) { const pk = (k - 1) >> 1; if (heap[pk][0] <= heap[k][0]) break; [heap[pk], heap[k]] = [heap[k], heap[pk]]; k = pk; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0;
    for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  RTF.fill(1e9);
  for (let j = 0; j < RH; j++) for (let i = 0; i < RW; i++) { const k = j * RW + i; if (inkA[k * 4 + 3] > 60) { RTF[k] = 40 + (1 - (j + 0.5) * RC / PH) * 2.6 * 1.6; push(RTF[k], k); } }
  const cost = new Float32Array(N);                             // beats per cell: slow, and faster along some fibres than others
  for (let j = 0; j < RH; j++) for (let i = 0; i < RW; i++) { const x = i * RC, y = j * RC; cost[j * RW + i] = RC / 15 * (0.55 + 1.1 * fbm2(x * 0.02, y * 0.02) + 0.5 * fbm2(x * 0.09 + 3, y * 0.09)); }
  const done = new Uint8Array(N);
  while (heap.length) { const [t, k] = pop(); if (done[k]) continue; done[k] = 1; if (t > 49) break; const i = k % RW, j = (k / RW) | 0;
    for (const [di, dj, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]]) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= RW || jj >= RH) continue; const kk = jj * RW + ii;
      const nt = t + w * (cost[k] + cost[kk]) / 2; if (nt < RTF[kk]) { RTF[kk] = nt; push(nt, kk); } } }
  for (let j = 0; j < RH; j++) for (let i = 0; i < RW; i++) { const x = (i + 0.5) * RC, y = (j + 0.5) * RC, nz = fbm2(x * 0.012, y * 0.012), nf = fbm2(x * 0.06 + 11, y * 0.06);
    const flood = 47.95 + (1 - y / PH) * 0.42 + (nz - 0.5) * 0.22 + (nf - 0.5) * 0.1;    // at 48 the red takes the sheet from the foot up
    RTF[j * RW + i] = Math.max(40.05, Math.min(RTF[j * RW + i] + (nf - 0.5) * 0.35, flood)); } }
const mkC = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const RMASK = mkC(RW, RH), RFRONT = mkC(RW, RH), gRM = RMASK.getContext('2d'), gRF = RFRONT.getContext('2d');
const RMD = gRM.createImageData(RW, RH), RFD = gRF.createImageData(RW, RH);
const TT = mkC(810, 1440), gTT = TT.getContext('2d'), TINT = mkC(810, 1440);
{ const g = TINT.getContext('2d'), id = g.createImageData(810, 1440), d = id.data;            // brick through crimson, mottled
  for (let j = 0; j < 1440; j++) for (let i = 0; i < 810; i++) { const x = i * PW / 810, y = j * PH / 1440, n = fbm2(x * 0.004 + 3, y * 0.004), m = fbm2(x * 0.03, y * 0.03 + 9);
    const k = (j * 810 + i) * 4, u = clamp((n - 0.3) * 2.2);
    d[k] = lerp(206, 196, u) + (m - 0.5) * 22; d[k + 1] = lerp(78, 44, u) + (m - 0.5) * 18; d[k + 2] = lerp(60, 58, u) + (m - 0.5) * 16; d[k + 3] = 255; }
  g.putImageData(id, 0, 0);
  const r = rng(77); g.lineCap = 'round';                        // the fibres take the dye unevenly: pale and dark hairs
  for (let i = 0; i < 9000; i++) { const x = r() * 810, y = r() * 1440, a = r() * Math.PI, l = 1 + r() * 7;
    g.strokeStyle = r() < 0.55 ? `rgba(255,190,170,${0.1 + r() * 0.16})` : `rgba(120,10,20,${0.08 + r() * 0.14})`; g.lineWidth = 0.3 + r() * 0.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } }
function redTide(g, b) {                                        // g: sheet 2, page units, clipped to the sheet
  if (b < 40.2) return;
  const m = RMD.data, f = RFD.data;
  const wash = b < 47.9 ? 0.62 : lerp(0.62, 1, clamp((b - 47.9) / 0.5));   // a dye wash until the flood, then full
  for (let i = 0; i < RW * RH; i++) { const d = b - RTF[i], c = d <= 0 ? 0 : d >= 0.7 ? 1 : (d / 0.7) ** 2 * (3 - 2 * d / 0.7);
    m[i * 4 + 3] = c * 255 * wash; f[i * 4 + 3] = d > 0 && d < 0.9 ? 255 * Math.exp(-((d - 0.3) ** 2) / 0.02) : 0; }
  gRM.putImageData(RMD, 0, 0); gRF.putImageData(RFD, 0, 0);
  gTT.globalCompositeOperation = 'copy'; gTT.imageSmoothingQuality = 'high'; gTT.drawImage(TINT, 0, 0);
  gTT.globalCompositeOperation = 'destination-in'; gTT.drawImage(RMASK, 0, 0, 810, 1440);
  g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(TT, 0, 0, PW, PH);
  gTT.globalCompositeOperation = 'copy'; gTT.fillStyle = '#8a2a2c'; gTT.fillRect(0, 0, 810, 1440);   // the tide line: wetter, darker
  gTT.globalCompositeOperation = 'destination-in'; gTT.drawImage(RFRONT, 0, 0, 810, 1440);
  g.globalAlpha = 0.3; g.drawImage(TT, 0, 0, PW, PH);
  g.restore();
}
// the seals: the central one presses in on the big stamp at 50; one more lands on each ALL HANDS. hit (52-55), along the
// signing block, none on another; ribbons under the central seal and one other
const SEALC = [PW / 2, 700];
const SEALS = [
  { x: SEALC[0], y: SEALC[1], r: 205, tp: 50, v: 0, rot: -0.03, rib: [Math.PI * 0.62, 330, 70], drop: 47.6 },
  { x: 150, y: RED_ROWS[5] + 150, r: 84, tp: 52, v: 1, rot: 0.05, rib: [Math.PI * 0.55, 150, 34] },
  { x: 940, y: RED_ROWS[3] + 34, r: 72, tp: 53, v: 2, rot: -0.04 },
  { x: 540, y: RED_ROWS[5] + 330, r: 90, tp: 54, v: 0, rot: 0.02 },
  { x: 900, y: RED_ROWS[5] + 520, r: 80, tp: 55, v: 1, rot: -0.06 },
];
function sheet2(b, t) {
  const q0 = performance.now();
  g2.save(); g2.setTransform(1, 0, 0, 1, 0, 0); g2.clearRect(0, 0, TW, TH); g2.drawImage(PAPER2, 0, 0); g2.restore();
  const q1 = performance.now();
  drawItems(g2, P2, b);
  if (PROF) console.log('s2 paper', Math.round(q1 - q0), 'items', Math.round(performance.now() - q1));
  for (const L of UNDER) underline(g2, L.x0, L.x1, L.y, L.seed, ease.inOutCubic(clamp((b - L.b0) / (L.b1 - L.b0))));
  if (b >= 32) { for (const s of SIGS) s.redK = clamp((b - 39.9 - (1 - s.ry / PH) * 4.16) / 0.3); drawItems(g2, SIGS, b); }   // the ink turns red, bottom rows first
  // v9: no red tide and no flood (brief P1). The paper stays cream; the wax bleeds a ring into the fibres round the central seal
  if (b >= 50) { const S = SEALS[0], k = clamp((b - 50) / 1.2), R = S.r * lerp(1.0, 1.28, ease.outCubic(k));
    g2.save(); g2.globalCompositeOperation = 'multiply'; g2.globalAlpha = ease.outCubic(k); g2.drawImage(BLEED, S.x - R * 1.28, S.y - R * 1.28, R * 2.56, R * 2.56); g2.restore(); }
  for (const S of SEALS) { if (S.rib) ribbon(g2, S.x, S.y, S.rib[0], S.rib[1], S.rib[2], clamp((b - S.tp + 0.4) / 0.5)); waxSeal(g2, S.x, S.y, S.r, b, S.tp, S.v, S.rot, S.drop); }
}

// ================================================================ the desk: WebGL composite + depth of field
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const gl = glc.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false });
const SCENE_FS = `#version 300 es
precision highp float;
uniform sampler2D uS1,uS2,uHandC,uHandH,uArmC,uArmH,uDesk,uNz; uniform vec2 uRes;
uniform vec3 uCam,uFwd,uRight,uUp; uniform float uTan; uniform vec2 uShift;
uniform mat3 uI1,uI2,uIHc; uniform vec4 uBoxA,uBoxB; uniform float uCMs; uniform float uZ2,uShow1,uShow2,uShowH,uHandLift;
uniform vec3 uFlame; uniform float uFlick,uT,uFocus,uAper,uHandSil,uRake;
out vec4 o;
float h21(vec2 p){p=fract(p*vec2(.1031,.103));p+=dot(p,p.yx+33.3);return fract((p.x+p.y)*p.x);}
float vn(vec2 x){vec2 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*vn(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
vec3 lin(vec3 c){return pow(c,vec3(2.2));}
// candle light: warm, falls off, flickers
vec3 lightAt(vec3 p,vec3 n,out float ndl){vec3 L=uFlame-p;float d=length(L);L/=d;ndl=max(dot(n,L),0.);
  float att=1./(1.+pow(d/1150.,2.));return vec3(1.,.66,.36)*3.1*att*uFlick;}
const vec3 AMB=vec3(.05,.052,.07);
// the desk: walnut, oiled, a little worn
const vec4 DESKR=vec4(-1400.,-1100.,2500.,3100.);
vec3 desk(vec2 q,out vec3 n,out float spec){vec4 d=texture(uDesk,(q-DESKR.xy)/(DESKR.zw-DESKR.xy));spec=d.a;
  vec2 g=texture(uNz,q*.0021).rg-.5; n=normalize(vec3(g*.06,1.)); return d.rgb;}
vec4 deskBake(vec2 q){vec3 n;float spec;
  vec2 w=q*vec2(.0022,.011); float warp=fbm(w*1.3)*3.;
  float ring=fract(q.y*.018+warp*1.6+fbm(q*vec2(.001,.02))*.8);
  float grain=smoothstep(.0,.2,ring)*smoothstep(1.,.55,ring);
  float pore=vn(q*vec2(.08,1.1))*vn(q*vec2(.3,.2));
  vec3 c=mix(vec3(.1,.052,.028),vec3(.23,.125,.06),grain*.8+.2*fbm(q*.004));
  c*=.8+.25*pore; c=mix(c,c*.6,smoothstep(.55,.9,fbm(q*.0015+3.)));
  float sc=smoothstep(.985,1.,vn(q*vec2(.05,.9)+vec2(0.,fbm(q*.01)*20.)));      // scratches catch the light
  c+=sc*.05;
  n=normalize(vec3((vn(q*vec2(.05,.6))-.5)*.08,(fbm(q*.02)-.5)*.06,1.));
  spec=.35+.3*(1.-pore); return vec4(lin(c*1.2),spec);}
// candle in a pewter chamberstick; inkwell: SDF, only near their bounds
const vec3 CAN=vec3(-175.,260.,0.), INKW=vec3(1215.,300.,0.);
float sdCyl(vec3 p,float r,float h){vec2 d=abs(vec2(length(p.xy),p.z-h*.5))-vec2(r,h*.5);return min(max(d.x,d.y),0.)+length(max(d,0.));}
float props(vec3 p,out float m){
  vec3 q=p-CAN; float dish=sdCyl(q,95.,10.)-3.; dish=min(dish,sdCyl(q-vec3(0,0,8.),34.,34.)-2.);
  float ring=length(vec2(length(q.xy-vec2(0.,-110.))-22.,q.z-18.))-5.;             // the finger ring
  dish=min(dish,ring);
  float drip=.8*sin(atan(q.y,q.x)*7.)*smoothstep(260.,160.,q.z);
  float wax=sdCyl(q-vec3(0,0,40.),27.+drip,230.);
  vec3 r=p-INKW; float well=sdCyl(r,62.,78.)-4.; well=min(well,sdCyl(r-vec3(0,0,78.),30.,18.)-3.);
  well=min(well,sdCyl(r,78.,10.)-2.);
  float d=min(min(dish,wax),well); m=d==wax?1.:d==well?2.:0.; return d;}
vec3 propN(vec3 p){float m;vec2 e=vec2(.6,-.6);return normalize(e.xyy*props(p+e.xyy,m)+e.yyx*props(p+e.yyx,m)+e.yxy*props(p+e.yxy,m)+e.xxx*props(p+e.xxx,m));}
vec4 sheetTex(sampler2D s,mat3 I,vec2 q,out vec2 uv){vec3 u=I*vec3(q,1.);uv=u.xy;
  if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)return vec4(0);return texture(s,uv);}
vec3 shadeSheet(vec4 tx,vec2 uv,vec3 p,float seed){             // paper lit by the candle; cockle and fibre relief
  vec2 g=texture(uNz,uv*vec2(.9,1.6)+seed*.13).ba-.5;
  vec3 n=normalize(vec3(g*.09,1.)); float ndl; vec3 L=lightAt(p,n,ndl);
  vec3 alb=lin(tx.rgb);
  vec3 c=alb*(L*(.25+.75*ndl)+AMB);
  float ink=1.-smoothstep(.15,.5,dot(tx.rgb,vec3(.33)));          // wet iron-gall has a faint sheen
  vec3 V=normalize(uCam-p),Hh=normalize(normalize(uFlame-p)+V); c+=L*ink*.06*pow(max(dot(n,Hh),0.),30.);
  return c;}
// the hand: hand-cm coordinates (y up, nib at 0) -> the fine sprite inside box A, the coarse arm sprite elsewhere in B
vec2 bxuv(vec4 B,vec2 c){return vec2((c.x-B.x)/(B.z-B.x),(B.w-c.y)/(B.w-B.y));}
bool inB(vec4 B,vec2 c,float m){return c.x>B.x+m&&c.x<B.z-m&&c.y>B.y+m&&c.y<B.w-m;}
float handH(vec2 c){vec4 h; if(inB(uBoxA,c,.3))h=texture(uHandH,bxuv(uBoxA,c)); else if(inB(uBoxB,c,.2))h=texture(uArmH,bxuv(uBoxB,c)); else return 0.;
  return (h.r+h.g/255.)*32.*step(.5,h.b);}
vec4 handC(vec2 c){if(inB(uBoxA,c,.3))return texture(uHandC,bxuv(uBoxA,c)); if(inB(uBoxB,c,.2))return texture(uArmC,bxuv(uBoxB,c)); return vec4(0);}
void main(){
  vec2 sp=(gl_FragCoord.xy/uRes)*2.-1.; sp.y+=uShift.y; sp.x+=uShift.x;
  vec3 rd=normalize(uFwd+sp.x*uRight*uTan*(uRes.x/uRes.y)+sp.y*uUp*uTan), ro=uCam;
  // desk plane z=0 (sheet 1 and the hand lie on it); sheet 2 at z=uZ2
  float t0=-ro.z/rd.z; vec3 p=ro+rd*t0; vec2 q=p.xy;
  vec3 col=vec3(0); float depth=t0;
  vec2 uvc; float cover=max(uShow1>0.?sheetTex(uS1,uI1,q,uvc).a:0.,uShow2>0.&&uZ2<.5?sheetTex(uS2,uI2,q,uvc).a:0.);
  if(cover<.999){ vec3 n; float spec; vec3 alb=desk(q,n,spec); float ndl; vec3 L=lightAt(p,n,ndl);
    vec3 V=-rd,Hh=normalize(normalize(uFlame-p)+V); col=alb*(L*ndl+AMB)+L*spec*.35*pow(max(dot(n,Hh),0.),60.);
    // the sheets' contact shadows on the desk (sheet thickness; the candle is low, so they reach)
    vec2 lxy=normalize(uFlame.xy-q)*14.; vec2 uvs; float sh=0.;
    if(uShow1>0.)sh=max(sh,sheetTex(uS1,uI1,q+lxy,uvs).a*uShow1);
    if(uShow2>0.)sh=max(sh,sheetTex(uS2,uI2,q+lxy*(1.+uZ2*.15),uvs).a*uShow2);
    col*=1.-.55*sh; }
  vec2 uv1; vec4 s1=uShow1>0.?sheetTex(uS1,uI1,q,uv1):vec4(0);
  if(s1.a>0.){ vec3 c=shadeSheet(s1,uv1,p,1.);
    if(uShow2>0.&&uZ2>.5){ vec2 lxy=(uFlame.xy-q)/max(uFlame.z,1.)*uZ2; vec2 uvs; vec3 u=uI2*vec3(q+lxy,1.);  // sheet 2's shadow while it is laid down
      float a=0.; if(u.x>0.&&u.y>0.&&u.x<1.&&u.y<1.) a=textureLod(uS2,u.xy,4.).a; c*=1.-.6*a*uShow2; }
    col=mix(col,c,s1.a*uShow1); }
  if(uShow2>0.){ float t2=(uZ2-ro.z)/rd.z; vec3 p2=ro+rd*t2; vec2 uv2; vec4 s2=sheetTex(uS2,uI2,p2.xy,uv2);
    if(s2.a>0.){ col=mix(col,shadeSheet(s2,uv2,p2,5.),s2.a*uShow2); depth=mix(depth,t2,step(.5,s2.a)); } }
  if(uShowH>0.){                                               // the hand sprite, baked as the camera sees it (parallax included)
    vec2 c=(uIHc*vec3(q,1.)).xy; vec4 h=handC(c);
    if(h.a>0.){ float hz=handH(c);
      float ndl; vec3 L=lightAt(p+vec3(0,0,hz*uCMs+40.),vec3(0,0,1),ndl); float k=clamp(length(L)*.42+.12,0.,1.3);
      float a=h.a*uShowH; vec3 hc=lin(h.rgb)*k;
      // v9: backlit. The candle is behind the hand: the body goes to silhouette and the edge facing the flame catches
      vec2 fd=normalize((uIHc*vec3(uFlame.xy,1.)).xy-c); float rim=clamp(h.a-handC(c+fd*.16).a,0.,1.);   // one thin catch-light
      vec3 sil=hc*.035+vec3(.9,.46,.2)*rim*.8*k*uFlick;
      col=mix(col,mix(hc,sil,uHandSil),a);
      if(a>.5&&hz>.3) depth=t0-hz*uCMs/max(-rd.z,.5); } }
  // props: candle, chamberstick, inkwell
  { float tt=0.; float m; bool hit=false; vec3 pp;
    vec3 oc1=ro-(CAN+vec3(0,0,140.)), oc2=ro-(INKW+vec3(0,0,50.)); float b1=dot(oc1,rd),b2=dot(oc2,rd);
    bool near=(b1*b1-dot(oc1,oc1)+300.*300.>0.)||(b2*b2-dot(oc2,oc2)+140.*140.>0.);
    if(near)for(int i=0;i<80;i++){pp=ro+rd*tt;float d=props(pp,m);if(d<.5){hit=true;break;}tt+=d;if(tt>t0+5.)break;}
    if(hit&&tt<depth+1.){ vec3 n=propN(pp); float ndl; vec3 L=lightAt(pp,n,ndl); vec3 V=-rd,Hh=normalize(normalize(uFlame-pp)+V);
      vec3 c;
      if(m==1.){ c=lin(vec3(.93,.88,.74))*(L*(.35+.65*ndl)+AMB)+lin(vec3(1.,.7,.4))*.5*smoothstep(150.,270.,pp.z-CAN.z); }    // wax glows near the flame
      else if(m==2.){ c=lin(vec3(.2,.2,.22))*(L*ndl+AMB)+L*.7*pow(max(dot(n,Hh),0.),40.); }
      else { c=lin(vec3(.45,.43,.4))*(L*ndl*.6+AMB)+L*.9*pow(max(dot(n,Hh),0.),30.); }
      col=c; depth=tt; } }
  // the flame and its glow (seen, and lighting the air)
  { vec3 fq=uFlame-ro; float tf=dot(fq,rd); if(tf>0.){ vec3 cp=ro+rd*tf-uFlame; float dz=cp.z/1.6; float r=length(vec2(length(cp.xy),dz));
      float core=exp(-r*r/(14.*14.))*uFlick, glow=exp(-r/90.)*.35*uFlick;
      if(tf<depth+40.){ col+=vec3(1.,.72,.35)*core*3.+vec3(1.,.5,.2)*glow; } } }
  if(uRake>0.){ float rk=smoothstep(-1.2,1.,sp.x*.8-sp.y*.35); col*=mix(1.,.25+1.25*rk,uRake); }   // raking light from the right
  col=col/(1.+col*.35);                                         // soft shoulder
  col=pow(col,vec3(1./2.2));
  float coc=clamp(uAper*abs(depth-uFocus)/depth,0.,1.);
  o=vec4(col,coc);
}`;
const DOF_FS = `#version 300 es
precision highp float; uniform sampler2D uSrc; uniform vec2 uRes; uniform float uMax; out vec4 o;
void main(){vec2 uv=gl_FragCoord.xy/uRes; vec4 c0=texture(uSrc,uv); float r0=c0.a*uMax;
  if(r0<.7){o=vec4(c0.rgb,1.);return;}
  vec3 acc=c0.rgb; float wt=1.;
  for(int i=0;i<40;i++){float fi=float(i)+.5; float a=fi*2.39996; float rr=sqrt(fi/40.)*r0;
    vec2 off=vec2(cos(a),sin(a))*rr/uRes; vec4 s=texture(uSrc,uv+off); float sr=s.a*uMax;
    float w=smoothstep(rr-2.,rr,sr+r0*.5)+.02;                   // a sharp neighbour does not smear into a blurred pixel
    float lum=dot(s.rgb,vec3(.3,.59,.11)); w*=1.+2.5*smoothstep(.75,1.,lum);   // bright spots bloom into discs
    acc+=s.rgb*w; wt+=w;}
  o=vec4(acc/wt,1.);}`;
const DOF_HALF_FS = DOF_FS.replace('uniform float uMax; out vec4 o;', 'uniform float uMax; uniform vec2 uSrcRes; out vec4 o;')
  .replace('vec2 uv=gl_FragCoord.xy/uRes;', 'vec2 uv=gl_FragCoord.xy/uRes;').replace('vec2 off=vec2(cos(a),sin(a))*rr/uRes;', 'vec2 off=vec2(cos(a),sin(a))*rr/uSrcRes;')
  .replace('if(r0<.7){o=vec4(c0.rgb,1.);return;}', 'if(r0<.7){o=vec4(c0.rgb,c0.a);return;}').replace('o=vec4(acc/wt,1.);}', 'o=vec4(acc/wt,c0.a);}')
  .replace('for(int i=0;i<40;i++){float fi=float(i)+.5; float a=fi*2.39996; float rr=sqrt(fi/40.)*r0;', 'for(int i=0;i<28;i++){float fi=float(i)+.5; float a=fi*2.39996; float rr=sqrt(fi/28.)*r0;');
const COMP_FS = `#version 300 es
precision highp float; uniform sampler2D uSrc,uHalf; uniform vec2 uRes; uniform float uMax,uFlash; out vec4 o;
void main(){vec2 uv=gl_FragCoord.xy/uRes; vec4 c=texture(uSrc,uv); vec3 bl=texture(uHalf,uv).rgb;
  float r=c.a*uMax; vec3 col=mix(c.rgb,bl,smoothstep(.6,2.6,r));
  float lum=dot(col,vec3(.3,.59,.11)); col+=uFlash*smoothstep(.3,.95,lum)*vec3(1.,.78,.5)*.7;   // the hit: warm light on the highlights only
  o=vec4(col,1.);}`;
const BAKE_FS = SCENE_FS.replace(/void main\(\)\{[\s\S]*$/, `void main(){vec2 uv=gl_FragCoord.xy/vec2(1536.);o=deskBake(mix(DESKR.xy,DESKR.zw,uv));}`);
const NZ_FS = `#version 300 es
precision highp float; out vec4 o;
float h21(vec2 p){p=fract(p*vec2(.1031,.103));p+=dot(p,p.yx+33.3);return fract((p.x+p.y)*p.x);}
float vn(vec2 x){vec2 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(h21(mod(i,64.)),h21(mod(i+vec2(1,0),64.)),f.x),mix(h21(mod(i+vec2(0,1),64.)),h21(mod(i+vec2(1,1),64.)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*vn(p);p=mod(p*2.,64.);a*=.5;}return s;}
void main(){vec2 p=gl_FragCoord.xy/512.*64.; float e=.25;
  float a=fbm(p), ax=fbm(mod(p+vec2(e,0),64.)), ay=fbm(mod(p+vec2(0,e),64.));
  float c=fbm(p*.25+13.), cx=fbm(mod(p*.25+13.+vec2(e,0),64.)), cy=fbm(mod(p*.25+13.+vec2(0,e),64.));
  o=vec4(.5+(ax-a)*6.,.5+(ay-a)*6.,.5+(cx-c)*4.,.5+(cy-c)*4.);}`;
const PR_SCENE = glProgram(gl, SCENE_FS), PR_HALF = glProgram(gl, DOF_HALF_FS), PR_COMP = glProgram(gl, COMP_FS);
const mkTex = (mip) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
const T1 = mkTex(true), T2 = mkTex(true), TFB = mkTex(false);
const THAND = {}; for (const k of Object.keys(HANDIMG)) THAND[k] = mkTex(!k.endsWith('_h'));
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
const upload = (tex, img, mip = true) => { gl.bindTexture(gl.TEXTURE_2D, tex);
  if (img.width > 1500 && img.getContext) {                      // the sheets: hand over the pixels, not the canvas (no snapshot stall)
    const d = img.getContext('2d').getImageData(0, 0, img.width, img.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, img.width, img.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(d.data.buffer));
  } else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D); };
for (const [k, img] of Object.entries(HANDIMG)) {                // height maps: raw bytes, no colour management, no mips
  const hgt = k.endsWith('_h'); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, hgt ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL); upload(THAND[k], img, !hgt); }
gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
gl.bindTexture(gl.TEXTURE_2D, TFB); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
const THALF = mkTex(false); gl.bindTexture(gl.TEXTURE_2D, THALF); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W / 2, H / 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
const FBH = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, FBH); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, THALF, 0);
function bakeTex(fs, w, h, mip) {                               // one-off procedural textures: the desk, the paper's cockle
  const t = mkTex(mip); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  const pr = glProgram(gl, fs); gl.useProgram(pr); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (mip) { gl.bindTexture(gl.TEXTURE_2D, t); gl.generateMipmap(gl.TEXTURE_2D); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); return t;
}
const TDESK = bakeTex(BAKE_FS, 1536, 1536, true), TNZ = bakeTex(NZ_FS, 512, 512, true);
const FB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, FB); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, TFB, 0);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
const UL = (p, n) => gl.getUniformLocation(p, n);
// desk <- sheet: sheet placement (translate, rotate); returns the inverse as a mat3 (column-major) desk(x,y) -> uv
function place(tx, ty, rot) { const c = Math.cos(rot), s = Math.sin(rot);
  const f = (x, y) => [tx + x * c - y * s, ty + x * s + y * c];
  const ic = [c / PW, -s / PH, 0, s / PW, c / PH, 0, (-tx * c - ty * s) / PW, (tx * s - ty * c) / PH, 1];
  return { f, inv: ic }; }
const SHEET1 = place(0, 0, -0.012);
function sheet2Place(b) {                                      // v9: slammed down over the first on the bell (16), from the right
  const u = ease.outCubic(clamp((b - 15.78) / 0.24));
  return { pl: place(lerp(1300, 34, u), lerp(260, -26, u), lerp(0.12, 0.009, u)), z: lerp(90, 0, u), u };
}
let lastUp1 = -1, lastUp2 = -1;

// ================================================================ camera: keyframes + the pen, pure in the beat
const smoothstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
// [beat, focusX, focusY, visible width, tilt°, follow-the-pen 0..1, aperture, cut]: eased between keys; a key marked cut
// starts a new shot (no move into it). The framing changes every 2-4 beats; nothing holds past a phrase.
const colY = cs => { const its = SIGNERS1.filter(it => cs.includes(it.col)); return (Math.min(...its.map(i => U(i).t)) + Math.max(...its.map(i => U(i).b))) / 2 + 90; };
const colX = c => 36 + (c + 0.5) * (PW - 72) / 6;
const HAN_Y = U(HANCOCK).t + (U(HANCOCK).b - U(HANCOCK).t) * 0.4, WALL_Y = RED_END + 300;
const SEAL_END = [SEALC[0], SEALC[1] + 105, 800, 12, 0, 6];      // the seal macro framing: frame 0 and the last frame (the loop)
const KEYS = [
  // 0-2: the seal macro (the sheet at its final state), the matrix lifting off
  [-1, ...SEAL_END], [2, SEALC[0], SEALC[1] + 95, 760, 12, 0, 6],
  // 10.5-16: Hancock's paraph (1 beat), three column-pair inserts cut on the beat, the wide
  [10.5, 560, HAN_Y + 40, 640, 24, 0.3, 14, 1], [10.95, 590, HAN_Y + 60, 600, 24, 0.3, 14],
  [11.0, (colX(0) + colX(1)) / 2 + 20, colY([0, 1]), 620, 24, 0.25, 14, 1], [12.45, (colX(0) + colX(1)) / 2 + 60, colY([0, 1]) + 40, 580, 24, 0.25, 14],
  [12.5, (colX(2) + colX(3)) / 2, colY([2, 3]), 620, 24, 0.25, 14, 1], [13.95, (colX(2) + colX(3)) / 2 + 40, colY([2, 3]) + 40, 580, 24, 0.25, 14],
  [14.0, (colX(4) + colX(5)) / 2 - 20, colY([4, 5]), 640, 24, 0.25, 14, 1], [15.45, (colX(4) + colX(5)) / 2 - 40, colY([4, 5]) + 40, 600, 24, 0.2, 14],
  [15.5, 540, 960, 1320, 20, 0, 6, 1], [15.78, 560, 960, 1360, 18, 0, 6],
  // 16: the 2024 sheet slams down on the bell (whip), ROUND TWO. printed on it; 18-21 the dateline in two shots
  [16, 560, 820, 1180, 18, 0, 6, 1], [17.95, 540, 780, 1100, 18, 0, 6],
  [18, 545, 300, 860, 18, 0.5, 14, 1], [19.5, 530, 320, 800, 18, 0.5, 14],
  [19.55, 540, 380, 780, 20, 0.55, 14, 1], [20.95, 540, 400, 740, 20, 0.55, 14],
  // 23-26: the long train written; ENOUGH. slammed across it
  [23, 520, 560, 820, 22, 0.45, 14, 1], [23.95, 520, 580, 800, 22, 0.45, 14],
  [24, 540, 700, 1000, 18, 0.15, 10, 1], [25.95, 540, 700, 940, 18, 0.15, 10],
  // 28-34: the red signatories (two inserts and the wide), then the first three workers
  [28, 420, RED_ROWS[1] + 120, 660, 24, 0.2, 14, 1], [29.8, 440, RED_ROWS[1] + 140, 620, 24, 0.2, 14],
  [29.85, 560, RED_ROWS[3] + 150, 700, 22, 0.15, 14, 1], [30.95, 560, RED_ROWS[3] + 160, 660, 22, 0.15, 14],
  [31, 540, (RED_ROWS[0] + RED_ROWS[5]) / 2 + 250, 980, 20, 0, 12, 1], [31.95, 540, (RED_ROWS[0] + RED_ROWS[5]) / 2 + 250, 940, 20, 0, 12],
  [32, 540, 1330, 900, 20, 0.1, 12, 1], [33.95, 540, 1320, 860, 20, 0.1, 12],
  // 48-52: raking light on the seal; the matrix comes down (48) and lifts (50)
  [48, SEALC[0], SEALC[1] + 120, 900, 14, 0, 8, 1], [49.95, SEALC[0], SEALC[1] + 105, 820, 14, 0, 8],
  [50, SEALC[0], SEALC[1] + 120, 880, 14, 0, 8, 1], [51.95, SEALC[0], SEALC[1] + 110, 820, 14, 0, 8],
  // 52-56: a broadside sealed on each kick, a cut to each seal
  ...[1, 2, 3, 4].flatMap(i => [[51 + i, SEALS[i].x * 0.6 + 540 * 0.4, Math.min(SEALS[i].y + 60, 1450), 760, 20, 0, 10, 1], [51.95 + i, SEALS[i].x * 0.6 + 540 * 0.4, Math.min(SEALS[i].y + 50, 1440), 720, 20, 0, 10]]),
  // 56-64: the whole sheet, then the push into the seal to match frame 0
  [56, 540, 900, 1250, 16, 0, 8, 1], [60, 540, 820, 1150, 15, 0, 8], [64, ...SEAL_END], [70, ...SEAL_END],
];
function camAt(b) {
  let i = 0; while (i < KEYS.length - 1 && KEYS[i + 1][0] <= b) i++;
  const A = KEYS[i], Bk = KEYS[Math.min(i + 1, KEYS.length - 1)], u = Bk[0] > A[0] && !Bk[7] ? smoothstep(A[0], Bk[0], b) : 0;
  const k = A.slice(0, 7).map((v, j) => lerp(v, Bk[j], u));
  let [, fx, fy, vw, tilt, follow, aper] = k;
  if (follow > 0) {                                             // lean toward where the pen has been (averaged: no whip)
    let sx = 0, sy = 0, n = 0;
    for (let j = 0; j < 10; j++) { const bb = b - j * 0.12, p = pen(bb); if (p.away > 0.8) continue;
      const d = (p.sheet === 1 ? SHEET1 : sheet2Place(bb).pl).f(p.x, p.y); sx += d[0]; sy += d[1]; n++; }
    if (n) { fx = lerp(fx, sx / n, follow * 0.3); fy = lerp(fy, sy / n, follow); }
    fx = clamp(fx, vw / 2 - 30, PW - vw / 2 + 30);
  }
  return { fx, fy, vw, tilt, aper };
}
const FOV = 34 * Math.PI / 180, TANV = Math.tan(FOV / 2);
function setCamera(b, t, kick) {
  const c = camAt(b);
  const hv = c.vw / (W / H) / 2 / TANV * (W / H), dist = c.vw / 2 / (TANV * W / H);
  const tl = c.tilt * Math.PI / 180, yaw = 0.06 * Math.sin(b * 0.21) - 0.05;
  const shx = Math.sin(t * 77) * 5 * kick, shy = Math.cos(t * 63) * 5 * kick;
  const F = [c.fx + shx, c.fy + shy, 0];
  const cam = [F[0] + Math.sin(yaw) * Math.sin(tl) * dist, F[1] + Math.cos(yaw) * Math.sin(tl) * dist, Math.cos(tl) * dist];
  const fwd = [F[0] - cam[0], F[1] - cam[1], F[2] - cam[2]], fl = Math.hypot(...fwd); fwd.forEach((v, i) => fwd[i] = v / fl);
  const upHint = [Math.sin(yaw) * 0.3, -1, 0.3];                 // page top is screen up
  const cr = (a, b2) => [a[1] * b2[2] - a[2] * b2[1], a[2] * b2[0] - a[0] * b2[2], a[0] * b2[1] - a[1] * b2[0]];
  let right = cr(upHint, fwd); const rl = Math.hypot(...right); right = right.map(v => v / rl);
  const up = cr(fwd, right);
  const roll = 0.012 * Math.sin(b * 0.37);
  const R2 = right.map((v, i) => v * Math.cos(roll) + up[i] * Math.sin(roll)), U2 = up.map((v, i) => v * Math.cos(roll) - right[i] * Math.sin(roll));
  return { cam, fwd, right: R2, up: U2, focus: fl, aper: c.aper, hv };
}

// ================================================================ the shots (a metric montage, cut on the kicks from 16)
const SHOTS = [[-99, 'desk'], [2, 'plates'], [7, 'square'], [9, 'crown'], [10.5, 'desk'], [21, 'split'], [23, 'desk'], [26, 'pass'],
  [28, 'desk'], [34, 'hands'], [36, 'press'], [40, 'hands'], [44, 'drop'], [46, 'rise'], [48, 'desk']];
const shotAt = b => { let k = SHOTS[0][1]; for (const [b0, kind] of SHOTS) if (b >= b0) k = kind; return k; };
const handOn = b => (b >= 10.5 && b < 15.5) || (b >= 18 && b < 34);          // the hand only in the writing inserts
// the brass matrix: lift 0 = seated on the central seal; null = not in shot
function matrixLift(b) {
  if (b < 2) return 0.5 + 0.5 * ease.outCubic(clamp(b / 1.4));
  if (b >= 48 && b < 50) return 1 - ease.inOutCubic(clamp((b - 48.15) / 1.75));
  if (b >= 50 && b < 52) return ease.outCubic(clamp((b - 50.06) / 0.9));
  return null;
}
function toScreen(cam, P) {
  const v = [P[0] - cam.cam[0], P[1] - cam.cam[1], P[2] - cam.cam[2]], z = v[0] * cam.fwd[0] + v[1] * cam.fwd[1] + v[2] * cam.fwd[2];
  const sx = (v[0] * cam.right[0] + v[1] * cam.right[1] + v[2] * cam.right[2]) / (z * TANV * W / H);
  const sy = (v[0] * cam.up[0] + v[1] * cam.up[1] + v[2] * cam.up[2]) / (z * TANV) + 0.2;
  return [(sx + 1) / 2 * W, H - (sy + 1) / 2 * H];
}
function drawMatrix(u, cam, pl) {
  const c = toScreen(cam, [...pl.f(SEALC[0], SEALC[1]), 0]), e = toScreen(cam, [...pl.f(SEALC[0] + SEALS[0].r, SEALC[1]), 0]);
  const rp = Math.hypot(e[0] - c[0], e[1] - c[1]) * 1.03;
  ctx.save(); ctx.filter = `blur(${10 + u * 18}px)`; ctx.fillStyle = `rgba(12,3,1,${0.7 * (1 - u * 0.6)})`;            // its shadow on the wax
  ctx.beginPath(); ctx.ellipse(c[0] + 20 + u * 110, c[1] + 30 + u * 160, rp * (1 + u * 0.4), rp * (1 + u * 0.4), 0, 0, 7); ctx.fill(); ctx.restore();
  const R = rp * (1 + u * 1.1), x = c[0] - u * 430, y = c[1] - u * 760;
  ctx.save(); if (u > 0.05) ctx.filter = `blur(${u * 7}px)`; ctx.drawImage(MATRIX, x - R * 640 / 600, y - R * 640 / 600, R * 2 * 640 / 600, R * 2 * 640 / 600); ctx.restore();
}
const SLIP = document.createElement('canvas'); SLIP.width = 1000; SLIP.height = 720;
{ const g = SLIP.getContext('2d'); g.drawImage(PAPER2, 40 * PS, 600 * PS, 1000 * PS, 720 * PS, 0, 0, 1000, 720);
  g.globalCompositeOperation = 'multiply'; const gr = g.createLinearGradient(0, 0, 940, 720); gr.addColorStop(0, '#fff6e6'); gr.addColorStop(1, '#e2d2b2'); g.fillStyle = gr; g.fillRect(0, 0, 1000, 720); }
// the cream slip laid on the sheet under the seal: 1776 AGAIN. on frame 0, the lockup at the close (the loop)
function slip(which, age, lines = null, em = 280, col = INKR, drop = which === 'lock') {
  const d = drop ? ease.outExpo(clamp(age / 0.12)) : 1;
  ctx.save(); ctx.translate(W / 2, 1450 + (1 - d) * 60); ctx.rotate(-0.022); ctx.scale(lerp(1.08, 1, d), lerp(1.08, 1, d)); ctx.globalAlpha = d;
  ctx.shadowColor = 'rgba(20,8,2,0.55)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 16; ctx.drawImage(SLIP, -500, -360); ctx.shadowColor = 'transparent';
  ctx.fillStyle = INKB; ctx.fillRect(-455, -318, 910, 6); ctx.fillRect(-455, 310, 910, 6);
  if (which === 'lock') { sigil(ctx, 0, -40, 190, { color: INKB, accent: INKR });
    ctx.font = '64px "Archivo Black"'; ctx.textAlign = 'center'; ctx.fillStyle = INKB; ctx.fillText('ACP.US', 0, 190); }
  else woodtype(ctx, lines || ['1776', 'AGAIN.'], 0, 0, { em, maxW: 880, color: col, age: which === '1776' ? 9 : age, seed: 1776 + em, lh: 0.95, each: true });
  ctx.restore();
}
let S1FULL = null;
const TMP = document.createElement('canvas'); TMP.width = W; TMP.height = H; const gTMP = TMP.getContext('2d');

// ================================================================ frame
const HM = HANDMETA;
window.renderFrame = async (t) => {
  const T0 = performance.now(), PX = new Uint8Array(4), mark = PROF ? (k) => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PX); console.log(k, Math.round(performance.now() - T0)); } : () => {};
  const beat = B.beat(t) + 1e-6, frame = Math.round(t * 30), spb = B.spb, shot = shotAt(beat);   // +eps: a cut on a beat lands on its frame
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  if (shot !== 'desk') {
    if (shot === 'plates') plates(ctx, beat, spb);
    else if (shot === 'square') square(ctx, beat, t, spb);
    else if (shot === 'crown') crown(ctx, beat, t, spb, { paper: PAPER1, seal: CROWN_SEAL });
    else if (shot === 'split') {
      if (!S1FULL) { sheet1(16.2); S1FULL = document.createElement('canvas'); S1FULL.width = S1.width; S1FULL.height = S1.height; S1FULL.getContext('2d').drawImage(S1, 0, 0); lastUp1 = -1; }
      sheet2(22.7); lastUp2 = -1;
      split(ctx, beat, spb, { s1: S1FULL, s2: S2, PS, first: FIRST, echo: ECHO });
    }
    else if (shot === 'pass') passPen(ctx, beat, t, spb);
    else if (shot === 'hands') hands(ctx, beat, spb);
    else if (shot === 'press') press(ctx, beat, t, spb);
    else if (shot === 'drop') waxDrop(ctx, beat, { paper: PAPER2 });
    else if (shot === 'rise') rise(ctx, beat, t, spb);
    finish.apply(ctx, frame, { grain: 0.08, vignette: 0.4 });
    return;
  }
  const kick = beat >= 16 ? Math.max(B.env('kick', t, 10), B.env('uf_kick', t, 10), B.env('press_stamp', t, 8), B.env('u3_platen', t, 12)) : 0;
  // 1. the sheets (2D), uploaded only when they change. Frame 0-2 shows sheet 2 at its final state (the loop)
  const sb = beat < 2 ? 55.8 : Math.min(beat, 55.8), s2 = sheet2Place(sb), show1 = sb < 16.1 ? 1 : 0, show2 = sb >= 15.78 ? 1 : 0;
  if (show1) { const key = Math.min(Math.round(sb * 30), 16.2 * 30); if (key !== lastUp1) { sheet1(sb); upload(T1, S1); lastUp1 = key; } }
  if (show2) { const key2 = sb > 55.7 ? 'static' : Math.round(sb * 120);
    if (key2 !== lastUp2) { sheet2(sb, t); upload(T2, S2); lastUp2 = key2; } }
  mark('sheets');
  // 2. the hand (backlit)
  const p = pen(beat), onSheet = p.sheet === 1 ? SHEET1 : s2.pl;
  const nd = onSheet.f(p.x, p.y), sl = p.sheet === 1 ? '1776' : '2024', lift = p.lift;
  const hrot = -0.04 + 0.08 * (p.x - PW / 2) / PW + 0.02 * Math.sin(beat * 3.1) + lift * 0.03 - p.away * 0.1;
  const CMs = CM * (1 + lift * 0.05);
  const ox = nd[0] - lift * 14, oy = nd[1] - lift * 18, c = Math.cos(hrot), s = Math.sin(hrot);
  const IHc = [c / CMs, s / CMs, 0, s / CMs, -c / CMs, 0, (-c * ox - s * oy) / CMs, (-s * ox + c * oy) / CMs, 1];
  const showH = handOn(beat) ? 1 - smoothstep(0.85, 1, p.away) : 0;
  // 3. camera + composite
  const cam = setCamera(beat, t, kick);
  gl.bindFramebuffer(gl.FRAMEBUFFER, FB); gl.viewport(0, 0, W, H); gl.useProgram(PR_SCENE);
  const u = n => UL(PR_SCENE, n);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T1); gl.uniform1i(u('uS1'), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T2); gl.uniform1i(u('uS2'), 1);
  [['uHandC', `${sl}_hand`], ['uHandH', `${sl}_hand_h`], ['uArmC', `${sl}_arm`], ['uArmH', `${sl}_arm_h`]].forEach(([n, k], i) => {
    gl.activeTexture(gl.TEXTURE5 + i); gl.bindTexture(gl.TEXTURE_2D, THAND[k]); gl.uniform1i(u(n), 5 + i); });
  gl.uniform4fv(u('uBoxA'), HM[`${sl}_hand`].box); gl.uniform4fv(u('uBoxB'), HM[`${sl}_arm`].box); gl.uniform1f(u('uCMs'), CMs);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, TDESK); gl.uniform1i(u('uDesk'), 3);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, TNZ); gl.uniform1i(u('uNz'), 4);
  gl.uniform2f(u('uRes'), W, H); gl.uniform3fv(u('uCam'), cam.cam); gl.uniform3fv(u('uFwd'), cam.fwd); gl.uniform3fv(u('uRight'), cam.right); gl.uniform3fv(u('uUp'), cam.up);
  gl.uniform1f(u('uTan'), TANV); gl.uniform2f(u('uShift'), 0, -0.2);
  gl.uniformMatrix3fv(u('uI1'), false, SHEET1.inv); gl.uniformMatrix3fv(u('uI2'), false, s2.pl.inv); gl.uniformMatrix3fv(u('uIHc'), false, IHc);
  gl.uniform1f(u('uZ2'), s2.z); gl.uniform1f(u('uShow1'), show1); gl.uniform1f(u('uShow2'), show2); gl.uniform1f(u('uShowH'), showH); gl.uniform1f(u('uHandLift'), lift * 1.6);
  gl.uniform1f(u('uHandSil'), 0.9); gl.uniform1f(u('uRake'), beat >= 48 && beat < 52 ? 0.85 : 0);
  const flick = 0.92 + 0.05 * Math.sin(t * 13.1) + 0.035 * Math.sin(t * 29.7 + 1) + 0.02 * Math.sin(t * 57.3);
  gl.uniform3f(u('uFlame'), -175 + 4 * Math.sin(t * 7.3), 260 + 3 * Math.sin(t * 5.1), 300); gl.uniform1f(u('uFlick'), flick);
  gl.uniform1f(u('uT'), t); gl.uniform1f(u('uFocus'), cam.focus); gl.uniform1f(u('uAper'), cam.aper * 0.2);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  mark('scene');
  gl.bindFramebuffer(gl.FRAMEBUFFER, FBH); gl.viewport(0, 0, W / 2, H / 2); gl.useProgram(PR_HALF);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, TFB); gl.uniform1i(UL(PR_HALF, 'uSrc'), 0);
  gl.uniform2f(UL(PR_HALF, 'uRes'), W / 2, H / 2); gl.uniform2f(UL(PR_HALF, 'uSrcRes'), W, H); gl.uniform1f(UL(PR_HALF, 'uMax'), 26);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(PR_COMP);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, TFB); gl.uniform1i(UL(PR_COMP, 'uSrc'), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, THALF); gl.uniform1i(UL(PR_COMP, 'uHalf'), 1);
  let flash = 0; for (const c0 of [16, 50]) if (beat >= c0 && beat < c0 + 0.2) flash = 0.55 * (1 - (beat - c0) / 0.2);
  gl.uniform2f(UL(PR_COMP, 'uRes'), W, H); gl.uniform1f(UL(PR_COMP, 'uMax'), 26); gl.uniform1f(UL(PR_COMP, 'uFlash'), flash);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  mark('dof');
  ctx.drawImage(glc, 0, 0);
  // 4. the matrix, the whip, the words, the slip
  const ml = matrixLift(beat); if (ml !== null) drawMatrix(ml, cam, s2.pl);
  if (beat >= 15.72 && beat < 16.14) {                           // the whip onto the 2024 sheet
    const a = 1 - Math.abs(beat - 15.93) / 0.21; gTMP.drawImage(ctx.canvas, 0, 0);
    ctx.globalAlpha = 0.16; for (let i = 1; i <= 8; i++) ctx.drawImage(TMP, -i * a * 70, 0); ctx.globalAlpha = 1; }
  for (const [b0, b1, lines, col, y, em, band] of DESK_TYPE) if (beat >= b0 && beat < b1) {
    if (band) {                                                   // over busy handwriting: a strip of the cream stock pasted on first
      const rot = -0.018 + (Math.round(b0) % 3) * 0.012; ctx.save(); ctx.translate(W / 2, y - em * 0.38); ctx.rotate(rot);
      ctx.shadowColor = 'rgba(20,8,2,0.5)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8; ctx.drawImage(SLIP, 0, 200, 1000, em * 1.25, -500, -em * 0.62, 1000, em * 1.25); ctx.restore(); }
    if (y === 'slip') slip('words', (beat - b0) * spb, lines, em, col, b0 === 48 || b0 === 56);
    else woodtype(ctx, lines, W / 2, y, { em, maxW: W - 110, color: col, age: (beat - b0) * spb, seed: Math.round(b0), rot: -0.018 + (Math.round(b0) % 3) * 0.012, lh: 0.9 }); }
  if (beat < 2) slip('1776', 9);
  if (beat >= CLOSE_AT) slip('lock', (beat - CLOSE_AT) * spb);
  finish.apply(ctx, frame, { grain: 0.08, vignette: 0.45 });
};
if (PROF) window.dbg = { seal: SEALV[0].pressed.toDataURL(), blob: SEALV[0].blob.toDataURL() };
window.sceneReady = true;
