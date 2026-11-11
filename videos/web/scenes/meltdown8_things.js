// MELTDOWN v11: the objects in the board's world and the section type faces (brief P1-P3, cycle 4m).
//   arm()          the one hand: backlit silhouette, printed; open (rising) -> closed fist, four knuckle bars
//   frost()        ice over a region: fern crystals, rime, icicles hanging off the rows
//   cracks()       the three cracks (the ≡) opening across the frozen board, light through them
//   seal() / licensed() / padlock() / gavel() / counter()   the freeze fragments (in-world text only)
//   nameplate()    the index row's private nameplate (a brass plate)
//   stairs()       Rodchenko: the board's rows as rungs from above, one left
//   stencil() / poster() / stampText() / molten()   the section faces (ice stencil, payoff poster, the press stamp, the melt)
import { W, H, C, clamp, lerp, ease, rng } from '../lib/kit.js';
import { hsh, sm, mk } from './meltdown8_flaps.js';

const TAU = Math.PI * 2;
const setF = (g, px, fam = 'Anton') => { g.font = `${Math.round(px)}px "${fam}"`; };

// ================================================================ the hand
// local units: palm width 100, wrist at (0,0), up = -y. close 0..1 (open -> fist). Returns the knuckle bars in local
// units [{x, y, w, h}] (the four finger segments' lit faces).
function handShape(close) {
  const P = new Path2D(), inner = [];
  const c = ease.inOutCubic(clamp(close));
  // forearm, and the rolled sleeve
  P.moveTo(-48, 0); P.bezierCurveTo(-56, 120, -70, 260, -82, 520); P.lineTo(88, 520); P.bezierCurveTo(78, 260, 62, 120, 50, 0); P.closePath();
  const sl = new Path2D(); sl.moveTo(-70, 270); sl.bezierCurveTo(-40, 250, 40, 250, 76, 262); sl.lineTo(96, 360); sl.bezierCurveTo(40, 340, -40, 342, -90, 360); sl.closePath();
  sl.moveTo(-84, 350); sl.lineTo(98, 350); sl.lineTo(110, 520); sl.lineTo(-100, 520); sl.closePath();
  // palm
  const top = lerp(-118, -104, c);
  P.moveTo(-52, 0); P.lineTo(-58, top + 18); P.quadraticCurveTo(-58, top, -40, top); P.lineTo(46, top - 2); P.quadraticCurveTo(60, top, 60, top + 18); P.lineTo(54, 0); P.closePath();
  // fingers: open capsules up; closed, they fold down over the palm (palm-side view): the fist's top is the row of
  // folded fingers, each finger's middle segment a face with a lit bar on it (the four ACP bars)
  const F = [[-37, 74, -0.1], [-12, 86, -0.03], [13, 82, 0.03], [37, 66, 0.1]], bars = [];
  const fold = sm(0.35, 1, c);
  F.forEach(([fx, L, sp], i) => {
    const len = lerp(L, 6, sm(0, 0.8, c)), w = lerp(23, 26, c), ang = sp * (1 - c);
    const x0 = fx, y0 = top + 6, x1 = x0 + Math.sin(ang) * len, y1 = y0 - Math.cos(ang) * len;
    P.moveTo(x0 - w / 2, y0); P.lineTo(x1 - w / 2, y1); P.arc(x1, y1, w / 2, Math.PI, 0); P.lineTo(x0 + w / 2, y0); P.closePath();
    if (fold > 0) {                                                   // the folded finger: a rounded knuckle bump on top, its face down the palm
      const kt = top - 26 * fold - (i === 1 || i === 2 ? 5 : 0) * fold, kb = top + 70 * fold;
      P.moveTo(fx - 13, kb); P.lineTo(fx - 13, kt + 13); P.arc(fx, kt + 13, 13, Math.PI, 0); P.lineTo(fx + 13, kb); P.closePath();
      bars.push({ x: fx - 8, y: kt + 8, w: 16, h: 44 });
    }
    inner.push([fx + 12.5 + (fold > 0 ? 0.5 : 0), lerp(y0 + 4, top - 18, fold), lerp(x1 + w / 2, fx + 13, fold), lerp(y1 + 2, top + 64, fold)]);
  });
  // thumb: out to the side (open) -> across the base of the fingers (fist)
  const ta = lerp(-2.3, -0.05, c), tx = lerp(-46, -54, c), ty = lerp(-46, top + 86, c), tl = lerp(60, 96, c);   // open: from the palm's edge, up and out
  const tx1 = tx + Math.cos(ta) * tl, ty1 = ty + Math.sin(ta) * tl, tw = lerp(32, 28, c);
  const T = new Path2D(); T.moveTo(tx, ty); T.lineTo(tx1, ty1); T.lineTo(tx1 + 0.01, ty1);   // a stroked capsule (filled as a stroke)
  return { P, sl, bars, inner, thumb: [tx, ty, tx1, ty1], T, tw };
}
// arm(g, x, y, scale, rot, close, o): o.rim (colour), o.light [x, y] (screen), o.ink, o.bars (0..1 lit), o.barCol
export function arm(g, x, y, s, rot, close, o = {}) {
  const { P, sl, bars, inner, thumb, T, tw } = handShape(close);
  const M = new DOMMatrix().translate(x, y).rotate(rot * 57.2958).scale(s, s);
  { const Q = new Path2D(); const [a0, b0, a1, b1] = thumb, n = [-(b1 - b0), a1 - a0], nl = Math.hypot(...n) || 1, k = tw / 2 / nl;   // the thumb, same winding as the palm
    const kb = k * (1.5 - 0.4 * clamp(close)); Q.moveTo(a0 + n[0] * kb, b0 + n[1] * kb); Q.lineTo(a0 - n[0] * kb, b0 - n[1] * kb);   // tapered: a thumb, not a blade Q.lineTo(a1 - n[0] * k, b1 - n[1] * k);
    Q.arc(a1, b1, tw / 2, Math.atan2(-n[1], -n[0]), Math.atan2(n[1], n[0]), false); Q.closePath(); var Qs = Q; }
  const Pp = new Path2D(); Pp.addPath(P, M); const Qp = new Path2D(); Qp.addPath(Qs, M); const Sp = new Path2D(); Sp.addPath(sl, M);
  const [lx, ly] = o.light || [x, y - 900], dx = lx - x, dy = ly - y, dl = Math.hypot(dx, dy) || 1, off = Math.max(3, s * 3.2);
  g.save();
  // the rim: the light is behind the hand; a hot edge toward it, a wide soft bloom
  g.save(); g.filter = `blur(${Math.round(s * 7)}px)`; g.globalAlpha = 0.55; g.fillStyle = o.rim || '#ff7a3a'; g.fill(Pp); g.fill(Qp); g.restore();
  g.save(); g.translate(dx / dl * off, dy / dl * off); g.fillStyle = o.rim || '#ff7a3a'; g.fill(Pp); g.fill(Qp); g.fill(Sp); g.restore();
  g.fillStyle = o.ink || '#130405'; g.fill(Pp); g.fill(Qp); g.fillStyle = o.sleeve || '#1c0708'; g.fill(Sp);
  // the sleeve's folds and the finger gaps as thin rim lines (the form turning to the backlight)
  g.save(); g.setTransform(g.getTransform().multiply(M)); g.strokeStyle = o.rimDim || 'rgba(255,110,60,0.5)'; g.lineWidth = 2.2 / s * 1.6; g.lineCap = 'round';
  for (const [a, b, c2, d] of inner) { g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke(); }
  for (const yy of [290, 318, 342]) { g.beginPath(); g.moveTo(-72, yy + 6); g.bezierCurveTo(-30, yy - 6, 30, yy - 6, 84, yy + 4); g.stroke(); }
  g.beginPath(); g.moveTo(thumb[0], thumb[1] + 12); g.lineTo(thumb[2], thumb[3] + 12); g.stroke();
  // the four knuckle bars: lit faces ON the four folded finger segments (the ACP stripes; light through the gaps)
  const lit = o.bars ?? 0;
  if (lit > 0) for (const b of bars) {
    g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,70,40,${0.45 * lit})`; g.fillRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10);
    g.globalCompositeOperation = 'source-over'; g.fillStyle = o.barCol || '#fff0d6'; g.globalAlpha = lit; g.fillRect(b.x, b.y, b.w, b.h); g.globalAlpha = 1;
  }
  g.restore(); g.restore();
  return bars.map(b => { const p = M.transformPoint(new DOMPoint(b.x + b.w / 2, b.y + b.h / 2)); return { x: p.x, y: p.y, w: b.w * s, h: b.h * s, rot }; });
}

// ================================================================ ice
const FROST = new Map();
function frostTex(w, h, seed) {
  const key = w + 'x' + h + ':' + seed; if (FROST.has(key)) return FROST.get(key);
  const c = mk(w, h), g = c.getContext('2d'), R = rng(seed);
  g.lineCap = 'round';
  for (let k = 0; k < 90; k++) {                                     // fern crystals: a spine and its branches
    let x = R() * w, y = R() * h, a = R() * TAU; const L = 40 + R() * 160;
    for (let d = 0; d < 3; d++) {
      const x1 = x + Math.cos(a) * L, y1 = y + Math.sin(a) * L;
      g.strokeStyle = `rgba(230,245,255,${0.18 + 0.2 * R()})`; g.lineWidth = 1.6 - d * 0.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x1, y1); g.stroke();
      for (let j = 1; j < 10; j++) { const u = j / 10, bx = lerp(x, x1, u), by = lerp(y, y1, u), bl = (1 - u) * L * 0.35;
        for (const sd of [-1, 1]) { const ba = a + sd * 0.8; g.lineWidth = 0.9; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl); g.stroke(); } }
      x = x1; y = y1; a += (R() - 0.5) * 1.2;
    }
  }
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(220,240,255,${0.1 + 0.3 * R() * R()})`; g.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2); }
  FROST.set(key, c); return c;
}
// frost(g, box, amount, t): a blue cast, rime and fern crystals over the box; icicles off `rows` (y list)
export function frost(g, x, y, w, h, amt, rows = [], seed = 3) {
  if (amt <= 0) return;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgba(120,180,235,${0.6 * amt})`; g.fillRect(x, y, w, h);
  g.globalCompositeOperation = 'screen'; g.fillStyle = `rgba(40,90,150,${0.35 * amt})`; g.fillRect(x, y, w, h);
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = amt; g.drawImage(frostTex(Math.round(w / 2), Math.round(h / 2), seed), x, y, w, h);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const R = rng(seed + 11);
  for (const ry of rows) for (let k = 0; k < 22; k++) {             // icicles hanging off each row
    const ix = x + R() * w, L = (10 + R() * R() * 70) * amt, iw = 3 + R() * 6;
    const gr = g.createLinearGradient(0, ry, 0, ry + L); gr.addColorStop(0, 'rgba(235,248,255,0.95)'); gr.addColorStop(1, 'rgba(160,210,250,0.2)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(ix - iw / 2, ry); g.lineTo(ix + iw / 2, ry); g.lineTo(ix + (R() - 0.5) * 2, ry + L); g.fill();
  }
  g.restore();
}
// the three cracks (the ≡): horizontal, jagged; open 0..1 each; heat 0..1 (light through)
export function cracks(g, ys, open, heat, t, x0 = 0, x1 = W) {
  g.save();
  ys.forEach((y, k) => {
    const o = open[k]; if (o <= 0) return;
    const R = rng(71 + k), n = 28, ext = ease.outCubic(clamp(o));
    const cx = (x0 + x1) / 2, half = (x1 - x0) / 2 * ext + 1;
    const pts = []; for (let i = 0; i <= n; i++) { const u = i / n; pts.push([cx - half + u * half * 2, y + (R() - 0.5) * 22 + Math.sin(u * 9 + k) * 5]); }
    const wdt = 3 + 26 * clamp(heat) * (0.6 + 0.4 * Math.sin(t * 13 + k));
    g.globalCompositeOperation = 'lighter';
    for (const [lw, col] of [[wdt * 5, 'rgba(255,120,40,0.18)'], [wdt * 2, 'rgba(255,190,110,0.55)'], [Math.max(2, wdt * 0.6), 'rgba(255,248,230,1)']]) {
      g.strokeStyle = col; g.lineWidth = lw; g.lineJoin = 'miter'; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.stroke(); }
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(230,248,255,0.7)'; g.lineWidth = 1.5;                  // side splinters
    for (let i = 2; i < n - 1; i += 3) { const [px, py] = pts[i]; g.beginPath(); g.moveTo(px, py); g.lineTo(px + (R() - 0.5) * 50, py + (R() < 0.5 ? -1 : 1) * (10 + R() * 30)); g.stroke(); }
  });
  g.restore();
}

// ================================================================ the freeze fragments (in-world text only)
function iceGround(g, top = '#0b2a4a', bot = '#02101f') { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, top); gr.addColorStop(1, bot); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
export function seal(g, t, age) {                                     // an embossed foil seal, PATENT PENDING round the rim
  iceGround(g); const cx = W / 2, cy = 900, R = 360 * (1 + 0.03 * Math.exp(-age * 8));
  g.save();
  for (let k = 0; k < 48; k++) { const a = k / 48 * TAU; g.fillStyle = k % 2 ? '#8fb6d6' : '#b8d8ee'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * 1.08, a, a + TAU / 48 + 0.01); g.fill(); }
  const gr = g.createRadialGradient(cx - R * 0.4, cy - R * 0.4, 20, cx, cy, R); gr.addColorStop(0, '#f2fbff'); gr.addColorStop(1, '#6f9cc2');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 0.94, 0, TAU); g.fill();
  g.strokeStyle = '#3d6c96'; g.lineWidth = 8; g.beginPath(); g.arc(cx, cy, R * 0.66, 0, TAU); g.stroke();
  g.fillStyle = '#123a60'; setF(g, 92); g.textAlign = 'center'; g.textBaseline = 'middle';
  const s = 'PATENT • PENDING • ', n = s.length;
  for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i - n / 4) * TAU / n; g.save(); g.translate(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8); g.rotate(a + Math.PI / 2); g.fillText(s[i], 0, 0); g.restore(); }
  g.fillStyle = '#1b4a74'; g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * TAU / 10, r = k % 2 ? R * 0.22 : R * 0.5; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.fill();
  g.restore();
}
export function licensed(g, t, age) {                                 // a rubber-stamp impression on an iced flap
  iceGround(g, '#12324f', '#030e1a');
  g.save(); g.translate(W / 2, 900); g.rotate(-0.12);
  g.fillStyle = '#c8dcea'; g.fillRect(-420, -260, 840, 520); g.fillStyle = '#9dbcd4'; g.fillRect(-420, 0, 840, 260); g.fillStyle = '#0a1c2c'; g.fillRect(-420, -3, 840, 6);
  const k = 1 + 0.15 * Math.exp(-age * 20);
  g.scale(k, k); g.strokeStyle = '#c4101f'; g.lineWidth = 16; g.strokeRect(-360, -130, 720, 260);
  g.fillStyle = '#c4101f'; setF(g, 190); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('LICENSED', 0, 10);
  g.globalCompositeOperation = 'destination-out'; const R = rng(5); for (let i = 0; i < 900; i++) { g.globalAlpha = R(); g.fillRect(-380 + R() * 760, -150 + R() * 300, 2 + R() * 5, 2 + R() * 4); }
  g.restore();
}
export function padlock(g, t, age) {                                  // a heavy padlock and chain across the board
  iceGround(g, '#0e2a44', '#020a14');
  g.save(); const cx = W / 2, cy = 980, drop = 60 * Math.exp(-age * 9) * Math.cos(age * 30);
  g.strokeStyle = '#6d8aa3'; g.lineWidth = 26;
  for (let i = -9; i <= 9; i++) { const x = cx + i * 58, y = cy - 330 + Math.abs(i) * 6; g.save(); g.translate(x, y); g.rotate(i % 2 ? 0 : Math.PI / 2); g.beginPath(); g.ellipse(0, 0, 38, 20, 0, 0, TAU); g.stroke(); g.restore(); }
  g.translate(0, drop);
  g.strokeStyle = '#8fa9bf'; g.lineWidth = 46; g.beginPath(); g.arc(cx, cy - 130, 150, Math.PI, 0); g.lineTo(cx + 150, cy); g.moveTo(cx - 150, cy - 130); g.lineTo(cx - 150, cy); g.stroke();
  const gr = g.createLinearGradient(cx - 240, 0, cx + 240, 0); gr.addColorStop(0, '#3e5870'); gr.addColorStop(0.35, '#d6e6f2'); gr.addColorStop(1, '#263a4d');
  g.fillStyle = gr; g.beginPath(); g.roundRect(cx - 240, cy - 30, 480, 400, 40); g.fill();
  g.fillStyle = '#081420'; g.beginPath(); g.arc(cx, cy + 140, 34, 0, TAU); g.fill(); g.fillRect(cx - 12, cy + 150, 24, 90);
  g.restore();
}
export function gavel(g, t, age) {                                    // the gavel comes down on its block
  iceGround(g, '#0c2640', '#020a12');
  const a = age < 0.12 ? lerp(-0.9, 0, ease.inCubic(age / 0.12)) : 0.05 * Math.exp(-(age - 0.12) * 12) * Math.sin((age - 0.12) * 50);
  g.save(); g.fillStyle = '#9cbbd3'; g.beginPath(); g.ellipse(W / 2 + 60, 1240, 300, 70, 0, 0, TAU); g.fill(); g.fillStyle = '#5c7f9c'; g.fillRect(W / 2 - 240, 1240, 600, 90); g.beginPath(); g.ellipse(W / 2 + 60, 1330, 300, 70, 0, 0, Math.PI); g.fill();
  g.translate(W / 2 + 620, 1120); g.rotate(a);
  g.fillStyle = '#6f93b1'; g.fillRect(-620, -24, 540, 48);
  const gr = g.createLinearGradient(0, -170, 0, 170); gr.addColorStop(0, '#e3f1fb'); gr.addColorStop(1, '#4d7394');
  g.fillStyle = gr; g.beginPath(); g.roundRect(-720, -150, 200, 300, 30); g.fill(); g.fillStyle = '#2a4a66'; g.fillRect(-720, -110, 200, 18); g.fillRect(-720, 92, 200, 18);
  g.restore();
  if (age > 0.1 && age < 0.5) { g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = `rgba(220,245,255,${1 - (age - 0.1) / 0.4})`; g.lineWidth = 5; const R = rng(8);
    for (let i = 0; i < 26; i++) { const an = Math.PI + R() * Math.PI, r0 = 60, r1 = 160 + R() * 240; g.beginPath(); g.moveTo(W / 2 + 60 + Math.cos(an) * r0 * 3, 1230 + Math.sin(an) * r0); g.lineTo(W / 2 + 60 + Math.cos(an) * r1 * 2.2, 1230 + Math.sin(an) * r1 * 0.8); g.stroke(); } g.restore(); }
}
// an empty shop counter in front of the jammed price (the board behind is drawn by the caller)
export function counter(g, t) {
  g.save();
  const gr = g.createLinearGradient(0, 1340, 0, H); gr.addColorStop(0, '#2b4a66'); gr.addColorStop(0.08, '#122a40'); gr.addColorStop(1, '#040c16');
  g.fillStyle = gr; g.fillRect(0, 1360, W, H - 1360);
  g.fillStyle = '#9ec3e0'; g.fillRect(0, 1330, W, 34); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, 1330, W, 5);
  g.fillStyle = '#0a1a2a'; g.fillRect(620, 1180, 300, 150); g.fillStyle = '#1b3550'; g.fillRect(640, 1120, 260, 70);          // the till, shut
  g.fillStyle = '#6f93b1'; g.fillRect(650, 1200, 240, 16);
  g.strokeStyle = 'rgba(200,230,255,0.25)'; g.lineWidth = 2; for (let x = 40; x < W; x += 120) { g.beginPath(); g.moveTo(x, 1400); g.lineTo(x - 30, H); g.stroke(); }
  g.restore();
}

// ================================================================ the index row's private nameplate
export function nameplate(g, x, y, w, h, text = 'ALADDIN') {
  g.save();
  const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, '#f1d488'); gr.addColorStop(0.45, '#b98a2e'); gr.addColorStop(1, '#6a4a14');
  g.fillStyle = gr; g.beginPath(); g.roundRect(x, y, w, h, h * 0.12); g.fill();
  g.strokeStyle = '#3a2606'; g.lineWidth = Math.max(2, h * 0.04); g.beginPath(); g.roundRect(x + h * 0.08, y + h * 0.08, w - h * 0.16, h * 0.84, h * 0.08); g.stroke();
  g.fillStyle = '#2a1a04'; setF(g, Math.min(h * 0.42, w * 0.105), 'Michroma'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x + w / 2, y + h * 0.53);
  g.fillStyle = '#3a2606'; for (const sx of [x + h * 0.18, x + w - h * 0.18]) { g.beginPath(); g.arc(sx, y + h / 2, h * 0.06, 0, TAU); g.fill(); }
  g.restore();
}

// ================================================================ Rodchenko: rungs from above
// n rungs on a diagonal field; left = how many still stand (from the top); light = the top rung's heat
export function stairs(g, t, left, light) {
  // Rodchenko, Stairs (1930): the board's rows seen from above as rungs on a hard diagonal, raking light, long shadows.
  // The rungs drop away from the bottom (no intermediate rungs) until only the top one, red and lit, is left.
  g.save(); g.fillStyle = '#e9dcc2'; g.fillRect(0, 0, W, H);
  const sg = g.createLinearGradient(0, 0, W, H); sg.addColorStop(0, 'rgba(255,240,215,0.5)'); sg.addColorStop(1, 'rgba(60,30,20,0.25)'); g.fillStyle = sg; g.fillRect(0, 0, W, H);
  g.translate(W / 2, H / 2); g.rotate(-0.42); g.translate(-W / 2, -H / 2);
  const n = 20, pitch = 150, y0 = lerp(960, 700, clamp((left - 1) / 4)), X0 = -1700, XW = W + 3400;   // the last rung settles to the centre
  for (let i = n - 1; i >= 0; i--) {
    const on = i === 0 ? 1 : clamp(left - i);                               // 1 = in place; falls away as it goes to 0
    if (on <= 0) continue;
    const fall = (1 - on), y = y0 + i * pitch + fall * fall * 900, x = -fall * 420;
    g.globalAlpha = i === 0 ? 1 : Math.min(1, on * 1.5);
    g.fillStyle = 'rgba(40,20,14,0.45)'; g.fillRect(X0 + x + 26, y + 88, XW, 64);        // the rung's long hard shadow
    g.fillStyle = i === 0 ? '#c4101f' : '#161010'; g.fillRect(X0 + x, y, XW, 96);
    g.fillStyle = i === 0 ? `rgba(255,225,185,${0.35 + 0.55 * light})` : 'rgba(255,240,220,0.22)'; g.fillRect(X0 + x, y, XW, 7);   // the lit nose
    for (let c = 0; c < 84; c++) { g.fillStyle = i === 0 ? 'rgba(70,0,0,0.4)' : 'rgba(255,255,255,0.06)'; g.fillRect(X0 + 20 + x + c * 64, y + 18, 54, 60);
      g.fillStyle = i === 0 ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.5)'; g.fillRect(X0 + 20 + x + c * 64, y + 47, 54, 2); }
  }
  g.globalAlpha = 1;
  if (light > 0) { g.globalCompositeOperation = 'lighter'; const lg = g.createLinearGradient(0, y0 - 200, 0, y0 + 300);
    lg.addColorStop(0, 'rgba(255,120,60,0)'); lg.addColorStop(0.5, `rgba(255,150,80,${0.35 * light})`); lg.addColorStop(1, 'rgba(255,120,60,0)'); g.fillStyle = lg; g.fillRect(X0, y0 - 200, XW, 500); }
  g.restore();
}

// ================================================================ type faces
// stencil on the ice: frosted white letters with the stencil's bridges cut, sprayed edge
export function stencil(g, text, cy, age, o = {}) {
  if (o.rows && o.rows.length > 1) { const sz = o.size || 200; o.rows.forEach((r, i) => stencil(g, r, cy + (i - (o.rows.length - 1) / 2) * sz * 1.25, age, { ...o, rows: null })); return; }
  const size = o.size || 230, maxW = W - 110; setF(g, size, 'Archivo Black');
  let s = size; while (g.measureText(text).width > maxW && s > 60) { s -= 4; setF(g, s, 'Archivo Black'); }
  const c = mk(W, s * 1.6), cg = c.getContext('2d'); setF(cg, s, 'Archivo Black'); cg.textAlign = 'center'; cg.textBaseline = 'middle';
  cg.fillStyle = '#eef8ff'; cg.fillText(text, W / 2, s * 0.8);
  cg.globalCompositeOperation = 'destination-out';                     // the bridges: a horizontal cut and one per letter
  cg.fillRect(0, s * 0.8 - s * 0.035, W, s * 0.07);
  const w = cg.measureText(text).width, x0 = W / 2 - w / 2; let x = x0;
  for (const ch of text) { const cw = cg.measureText(ch).width; if (/[OQDBPRA0689]/.test(ch)) cg.fillRect(x + cw * 0.46, 0, cw * 0.08, s * 1.6); x += cw; }
  const R = rng(3); for (let i = 0; i < 1600; i++) { cg.globalAlpha = R() * 0.8; cg.fillRect(x0 - 20 + R() * (w + 40), s * 0.2 + R() * s * 1.2, 1 + R() * 3, 1 + R() * 3); }
  const k = 1 + 0.08 * Math.exp(-age * 16);
  g.save(); g.translate(W / 2, cy); g.scale(k, k);
  g.fillStyle = 'rgba(2,14,28,0.72)'; g.fillRect(-W / 2 + 30, -s * 0.72, W - 60, s * 1.44);
  g.shadowColor = 'rgba(160,220,255,0.9)'; g.shadowBlur = 24; g.drawImage(c, -W / 2, -s * 0.8); g.restore();
}
// the payoff poster face: cream Anton, red keyline, a black outer stroke (the v10 face, kept for the payoff)
export function poster(g, text, cy, age, o = {}) {
  const rows = o.rows || [text], size = o.size || 250, k = 1 + 0.16 * Math.exp(-12 * age);
  g.save(); g.translate(W / 2, cy); g.scale(k, k); g.translate(-W / 2, -cy);
  rows.forEach((r, i) => {
    const y = cy + (i - (rows.length - 1) / 2) * size * 0.98 + size * 0.36;
    let s = size; setF(g, s); while (g.measureText(r).width > (W - 120) / k && s > 40) { s -= 4; setF(g, s); }
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
    g.lineWidth = 30; g.strokeStyle = '#0a0306'; g.strokeText(r, W / 2, y);
    g.lineWidth = 12; g.strokeStyle = o.key || C.red2; g.strokeText(r, W / 2, y);
    g.fillStyle = (o.fills && o.fills[i]) || o.fill || '#fff4e2'; g.fillText(r, W / 2, y);
  });
  g.restore();
}
// the press stamp: a red rubber-stamp impression (NATIONALIZED.), slammed
export function stampText(g, text, cx, cy, age, o = {}) {
  const size = o.size || 170, k = age < 0.06 ? lerp(1.8, 1, ease.inCubic(age / 0.06)) : 1 + 0.02 * Math.exp(-(age - 0.06) * 10);
  g.save(); g.translate(cx, cy); g.rotate(o.rot ?? -0.08); g.scale(k, k);
  let s = size; setF(g, s); while (g.measureText(text).width > W - 190 && s > 40) { s -= 4; setF(g, s); }
  const w = g.measureText(text).width + 70, h = s * 1.12;
  const c = mk(w + 40, h + 40), cg = c.getContext('2d'); setF(cg, s); cg.textAlign = 'center'; cg.textBaseline = 'middle';
  cg.strokeStyle = '#d0121e'; cg.lineWidth = 14; cg.strokeRect(20, 20, w, h); cg.fillStyle = '#d0121e'; cg.fillText(text, 20 + w / 2, 20 + h / 2 + s * 0.04);
  cg.globalCompositeOperation = 'destination-out'; const R = rng(9);
  for (let i = 0; i < 1400; i++) { cg.globalAlpha = 0.3 + R() * 0.7; cg.fillRect(R() * (w + 40), R() * (h + 40), 1 + R() * 4, 1 + R() * 3); }
  g.globalAlpha = age < 0.03 ? 0.6 : 0.95; g.drawImage(c, -(w + 40) / 2, -(h + 40) / 2);
  g.restore();
}
// the melt face: Anton in molten gold with a dark keyline
export function molten(g, text, cy, age, t, o = {}) {
  const size = o.size || 280, k = 1 + 0.14 * Math.exp(-12 * age);
  g.save(); g.translate(W / 2, cy); g.scale(k, k);
  let s = size; setF(g, s); while (g.measureText(text).width > W - 120 && s > 40) { s -= 4; setF(g, s); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(14,2,1,0.82)'; g.fillRect(-W / 2 + 26, -s * 0.62, W - 52, s * 1.24);
  const gr = g.createLinearGradient(0, -s * 0.5, 0, s * 0.5), p = (t * 0.8) % 1;
  gr.addColorStop(0, '#fff6d8'); gr.addColorStop(clamp(0.3 + 0.2 * p), '#ffc248'); gr.addColorStop(0.7, '#ff7a14'); gr.addColorStop(1, '#b8260a');
  g.lineJoin = 'round'; g.lineWidth = 28; g.strokeStyle = '#1a0302'; g.strokeText(text, 0, 0);
  g.lineWidth = 10; g.strokeStyle = '#7a0a06'; g.strokeText(text, 0, 0);
  g.fillStyle = gr; g.fillText(text, 0, 0);
  const R = rng(text.length); g.fillStyle = '#ffb030';                  // drips off the letters' feet
  const w = g.measureText(text).width;
  for (let i = 0; i < 9; i++) { const x = -w / 2 + R() * w, L = (20 + R() * 90) * clamp(age * 2.5); g.beginPath(); g.moveTo(x - 7, s * 0.3); g.lineTo(x + 7, s * 0.3); g.lineTo(x + 3, s * 0.3 + L); g.arc(x, s * 0.3 + L, 4, 0, Math.PI); g.fill(); }
  g.restore();
}
