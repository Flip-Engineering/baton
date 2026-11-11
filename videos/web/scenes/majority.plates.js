// THE MAJORITY (majority), cycle R1: the 2D plates. Everything here is drawn, not rendered: the lit turf seen over the
// crowd's heads, the turnstile macros (STRAIGHT FROM WORK.), the video board and its mascot race (TEAM SPORTS.), the
// fan-cam chrome (HOME TEAM.), the rim parapet against the night (MAKE ROOM.), the four regions (rowhouses, a headframe
// town, a refinery catwalk under its flare, a harvest crew under field lights), and the card stunt that locks the ACP
// mark (COMMUNIST.) with the kid's upside-down card. Rules: no faces (hands, backs, silhouettes only), no party or
// league marks (the mascots are grey and generic), no sky over the crowd walls, the red kept for the stripes and the mark.
import { W, H, clamp, lerp, ease, smooth, rng } from '../lib/kit.js';

export const PAL = {
  ink: '#05060a', night: '#0a0d16', slate: '#161c2a', steel: '#2a2e38', turf: '#7d9a66', turfD: '#4e6a45', line: '#eef0e6',
  cream: '#F4E6D0', red: '#C8161C', redD: '#7a0a0c', navy: '#101a3c', sodium: '#ffb35a', flood: '#f2f4ff', green: '#46ff8a',
};
const TAU = Math.PI * 2;
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const cv = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ================================================================ the lit turf, seen from the stands over the heads
// y0..y1: the band; k: flood level; the yard lines run across the frame, converging slightly (a long lens looking down)
export function turf(g, y0, y1, { k = 1, t = 0, lines = true, vanish = 540, glow = 1 } = {}) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, shade(PAL.turf, 0.55 * k + 0.1)); gr.addColorStop(0.5, shade(PAL.turf, 0.95 * k + 0.05)); gr.addColorStop(1, shade(PAL.turfD, 0.8 * k + 0.05));
  g.fillStyle = gr; g.fillRect(0, y0, W, y1 - y0);
  // mowing stripes
  g.save(); g.globalAlpha = 0.18 * k;
  for (let i = -6; i < 14; i++) { const xa = vanish + (i * 150 - vanish) * 0.8, xb = vanish + (i * 150 - vanish) * 1.25; if (i % 2) continue;
    g.fillStyle = '#0f1a0c'; g.beginPath(); g.moveTo(xa, y0); g.lineTo(xa + 120, y0); g.lineTo(xb + 190, y1); g.lineTo(xb, y1); g.fill(); }
  g.restore();
  if (lines) {   // yard lines (across) and hash marks: the field's own graphic, soft with distance
    g.save(); g.strokeStyle = `rgba(240,242,232,${0.55 * k + 0.1})`;
    for (let i = 0; i < 7; i++) { const y = y0 + (y1 - y0) * (0.08 + i * 0.15); g.lineWidth = 2 + i * 0.9; g.beginPath(); g.moveTo(-20, y - 18); g.lineTo(W + 20, y + 18); g.stroke();
      for (let x = 40; x < W; x += 58) { g.lineWidth = 1.5 + i * 0.4; g.beginPath(); g.moveTo(x, y + (x / W) * 36 - 18 + (y1 - y0) * 0.075 - 6); g.lineTo(x, y + (x / W) * 36 - 18 + (y1 - y0) * 0.075 + 6); g.stroke(); } }
    g.restore();
  }
  // the flood pool: a soft bright centre, halation into the heads below
  if (glow) { const rg = g.createRadialGradient(W * 0.55, (y0 + y1) / 2, 10, W * 0.55, (y0 + y1) / 2, W * 0.9);
    rg.addColorStop(0, `rgba(255,250,230,${0.28 * k * glow})`); rg.addColorStop(1, 'rgba(255,250,230,0)'); g.fillStyle = rg; g.fillRect(0, y0, W, y1 - y0); }
}
export function shade(hex, k) { const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255; return `rgb(${Math.round(clamp(r * k, 0, 255))},${Math.round(clamp(gg * k, 0, 255))},${Math.round(clamp(b * k, 0, 255))})`; }
// the stepped concrete between the ranks of a wall: a dark riser under each foot line, the seat-back rail catching light
export function steps(g, feet, { k = 1, col = '#0b0d13', rail = 'rgba(255,226,180,0.16)' } = {}) {
  g.save();
  for (let i = 0; i < feet.length; i++) { const y = feet[i], h = i ? Math.abs(feet[i - 1] - y) : 200;
    const gr = g.createLinearGradient(0, y - h * 0.2, 0, y + h * 0.9); gr.addColorStop(0, shade('#1a1e2a', 0.7 + 0.3 * k)); gr.addColorStop(1, col);
    g.fillStyle = gr; g.fillRect(0, y - h * 0.15, W, h * 1.1);
    g.fillStyle = rail; g.fillRect(0, y - h * 0.15, W, Math.max(1, h * 0.02)); }
  g.restore();
}

// ================================================================ STRAIGHT FROM WORK.: four turnstile macros
// i: 0 a leather work glove with a laminated badge; 1 a hospital badge on its reel; 2 a hi-vis cuff; 3 a work boot
// through the tripod arm. age: seconds since the shot's cut (the chirp is at +0.02 s: the LED goes green, the card taps)
export function turnstile(g, i, age) {
  const chirp = age > 0.02, tap = chirp ? Math.exp(-(age - 0.02) * 14) : 0, push = 1 + 0.03 * age;
  g.save();
  // the concourse: sodium from above, dark, a band of cold flood spilling in from the gate behind
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#171a22'); bg.addColorStop(0.55, '#0b0c10'); bg.addColorStop(1, '#050507');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const spill = g.createRadialGradient(W * 0.8, H * 0.08, 20, W * 0.8, H * 0.08, H * 0.7); spill.addColorStop(0, 'rgba(255,190,110,0.35)'); spill.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = spill; g.fillRect(0, 0, W, H);
  g.translate(W / 2, H * 0.62); g.scale(push, push); g.translate(-W / 2, -H * 0.62);
  if (i === 3) { tripod(g, age, chirp); g.restore(); return; }
  // the reader pillar: brushed gunmetal, a black glass pad, the status bar
  const px = 170, py = 1010, pw = 740, ph = 980;
  const pg = g.createLinearGradient(px, 0, px + pw, 0); pg.addColorStop(0, '#16181e'); pg.addColorStop(0.3, '#3a3e48'); pg.addColorStop(0.55, '#262a32'); pg.addColorStop(1, '#101216');
  g.fillStyle = pg; rr(g, px, py, pw, ph, 40); g.fill();
  g.strokeStyle = 'rgba(255,210,150,0.35)'; g.lineWidth = 3; rr(g, px + 2, py + 2, pw - 4, ph - 4, 38); g.stroke();
  for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(255,255,255,${0.012 + 0.01 * hash(k)})`; g.fillRect(px + 10, py + 20 + k * 16, pw - 20, 1); }   // brushing
  const gx = 290, gy = 1090, gw = 500, gh = 380;
  g.fillStyle = '#040406'; rr(g, gx, gy, gw, gh, 26); g.fill();
  g.strokeStyle = '#1c1f26'; g.lineWidth = 6; rr(g, gx, gy, gw, gh, 26); g.stroke();
  // contactless arcs, lit green on the chirp
  const led = chirp ? PAL.green : '#e0302a';
  g.save(); g.translate(gx + gw / 2, gy + gh / 2 + 20); g.strokeStyle = chirp ? 'rgba(70,255,138,0.9)' : 'rgba(120,130,150,0.35)'; g.lineCap = 'round';
  for (let k = 0; k < 3; k++) { g.lineWidth = 14; g.beginPath(); g.arc(-60, 0, 50 + k * 42, -0.7, 0.7); g.stroke(); }
  g.restore();
  // the status bar over the pad (and its glow on the card)
  g.fillStyle = led; rr(g, gx + 60, gy - 60, gw - 120, 22, 11); g.fill();
  const lg = g.createRadialGradient(gx + gw / 2, gy - 50, 5, gx + gw / 2, gy - 50, 520); lg.addColorStop(0, chirp ? 'rgba(70,255,138,0.55)' : 'rgba(224,48,42,0.25)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = lg; g.fillRect(0, gy - 600, W, 1200);
  // the card: tapped down onto the pad on the chirp
  const cy = gy - 330 + 220 * (chirp ? 1 - 0.25 * (1 - tap) : 0) + 40 * tap, cx = 330 + (i === 1 ? 40 : 0), cw = 420, ch = 270, rot = -0.12 + 0.05 * i;
  // what holds it
  g.save(); g.translate(cx + cw / 2, cy + ch / 2); g.rotate(rot);
  if (i === 0) {        // lanyard up out of frame, the leather glove pinching the top edge
    lanyard(g, '#d86a1c', 0, -ch / 2);
    card(g, cw, ch, '#2458a8', led, chirp);
    glove(g, cw * 0.28, -ch * 0.52, '#6a4426', '#3a2414', 1.0);
  } else if (i === 1) { // the reel on a teal scrubs pocket, the cord taut, a bare hand in shadow at the bottom corner
    g.strokeStyle = '#141414'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, -ch / 2); g.lineTo(-30, -ch / 2 - 700); g.stroke();
    g.fillStyle = '#1f5f68'; g.fillRect(-420, -ch / 2 - 900, 700, 240);                 // the scrubs top, out of focus
    g.fillStyle = '#2a2d33'; g.beginPath(); g.arc(-30, -ch / 2 - 660, 44, 0, TAU); g.fill();
    card(g, cw, ch, '#1f7a78', led, chirp);
    glove(g, -cw * 0.34, ch * 0.44, '#3b2a22', '#1e1511', 0.9, true);
  } else {              // the hi-vis cuff: a sleeve with the silver tape, the gloved fingers on the card's end
    card(g, cw, ch, '#2f8a3a', led, chirp);
    g.save(); g.rotate(-0.35); g.fillStyle = '#b8c81c'; g.fillRect(cw * 0.2, -ch * 1.6, 380, 330);
    g.fillStyle = '#d8dde0'; g.fillRect(cw * 0.2, -ch * 1.6 + 120, 380, 46); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(cw * 0.2, -ch * 1.6 + 128, 380, 6);
    g.fillStyle = '#23242a'; g.fillRect(cw * 0.2, -ch * 1.6 + 300, 380, 40); g.restore();
    glove(g, cw * 0.44, -ch * 0.2, '#2c2e34', '#15161a', 1.05);
  }
  g.restore();
  g.restore();
}
function lanyard(g, col, x, y) {
  g.save(); g.fillStyle = col; g.beginPath(); g.moveTo(x - 20, y); g.lineTo(x - 60, y - 900); g.lineTo(x - 18, y - 900); g.lineTo(x + 10, y); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x - 40, y - 900, 8, 900); g.fillStyle = '#9aa0a8'; rr(g, x - 26, y - 34, 40, 40, 8); g.fill(); g.restore();
}
function card(g, cw, ch, stripe, led, chirp) {
  g.save();
  g.fillStyle = '#e9e4d8'; rr(g, -cw / 2, -ch / 2, cw, ch, 18); g.fill();
  g.fillStyle = stripe; g.save(); rr(g, -cw / 2, -ch / 2, cw, ch, 18); g.clip(); g.fillRect(-cw / 2, -ch / 2, cw, 60); g.restore();
  g.fillStyle = '#5a5e66'; rr(g, -cw / 2 + 26, -ch / 2 + 84, 110, 140, 8); g.fill();              // the photo: a grey block (no face)
  g.fillStyle = '#3a3e46'; g.beginPath(); g.arc(-cw / 2 + 81, -ch / 2 + 140, 26, 0, TAU); g.fill(); g.fillRect(-cw / 2 + 46, -ch / 2 + 176, 70, 48);
  g.fillStyle = '#2a2d33'; for (let k = 0; k < 4; k++) g.fillRect(-cw / 2 + 160, -ch / 2 + 96 + k * 26, 200 - k * 30, 12);   // the name, unreadable bars
  for (let k = 0; k < 34; k++) { if (hash(k * 3.1) < 0.4) continue; g.fillRect(-cw / 2 + 160 + k * 6.2, ch / 2 - 60, 3 + 3 * hash(k), 36); }   // barcode
  g.globalCompositeOperation = 'source-atop'; const sg = g.createLinearGradient(0, ch / 2, 0, -ch / 2);
  sg.addColorStop(0, chirp ? 'rgba(70,255,138,0.45)' : 'rgba(224,48,42,0.2)'); sg.addColorStop(0.5, 'rgba(0,0,0,0.05)'); sg.addColorStop(1, 'rgba(255,190,110,0.25)');
  g.fillStyle = sg; g.fillRect(-cw / 2, -ch / 2, cw, ch); g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(255,240,220,0.6)'; g.lineWidth = 2; rr(g, -cw / 2, -ch / 2, cw, ch, 18); g.stroke();
  g.restore();
}
// a gloved hand pinching: palm mass, four finger pads over the edge, the thumb, a rim of sodium on top
function glove(g, x, y, col, dark, s = 1, under = false) {
  g.save(); g.translate(x, y); g.scale(s, under ? -s : s);
  g.fillStyle = dark; g.beginPath(); g.ellipse(40, -120, 150, 120, -0.5, 0, TAU); g.fill();            // the back of the hand
  g.fillStyle = col;
  for (let k = 0; k < 4; k++) { rr(g, -80 + k * 52, -60, 50, 118, 24); g.fill(); }                  // fingers over the edge
  g.beginPath(); g.ellipse(-120, -40, 34, 70, -0.6, 0, TAU); g.fill();                                   // the thumb
  g.fillStyle = dark; g.fillRect(-10, -300, 230, 150);                                                   // the cuff
  g.strokeStyle = 'rgba(255,200,130,0.55)'; g.lineWidth = 4;
  for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(-55 + k * 52, -52, 22, Math.PI * 1.05, Math.PI * 1.95); g.stroke(); }
  g.restore();
}
function tripod(g, age, chirp) {
  // the tripod turnstile from above: the hub, three steel arms, one swinging through as a boot drives it
  const cx = 540, cy = 1180, a = -0.4 + ease.outCubic(clamp(age / 0.25)) * 1.2;
  g.fillStyle = '#1a1c22'; rr(g, 120, 1080, 840, 900, 30); g.fill();
  g.fillStyle = '#2e323c'; g.beginPath(); g.arc(cx, cy, 90, 0, TAU); g.fill();
  for (let k = 0; k < 3; k++) { const th = a + k * TAU / 3; g.save(); g.translate(cx, cy); g.rotate(th);
    const sg = g.createLinearGradient(0, -22, 0, 22); sg.addColorStop(0, '#dfe4ea'); sg.addColorStop(0.5, '#7c828c'); sg.addColorStop(1, '#2a2e36');
    g.fillStyle = sg; rr(g, 60, -22, 520, 44, 22); g.fill(); g.restore(); }
  g.fillStyle = chirp ? PAL.green : '#e0302a'; g.beginPath(); g.moveTo(820, 1140); g.lineTo(900, 1180); g.lineTo(820, 1220); g.fill();
  const lg = g.createRadialGradient(860, 1180, 5, 860, 1180, 300); lg.addColorStop(0, chirp ? 'rgba(70,255,138,0.5)' : 'rgba(224,48,42,0.25)'); lg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = lg; g.fillRect(500, 900, 600, 600);
  // the boot: a steel-toe work boot from above, stepping through (tan leather, dark sole edge, laces)
  const bx = 380 + 260 * ease.outCubic(clamp(age / 0.3)), by = 1500 - 200 * ease.outCubic(clamp(age / 0.3));
  g.save(); g.translate(bx, by); g.rotate(-0.5);
  g.fillStyle = '#16100c'; g.beginPath(); g.ellipse(0, 0, 150, 330, 0, 0, TAU); g.fill();
  g.fillStyle = '#8a5a2c'; g.beginPath(); g.ellipse(0, -10, 128, 300, 0, 0, TAU); g.fill();
  g.fillStyle = '#6a4220'; g.beginPath(); g.ellipse(0, -190, 110, 110, 0, 0, TAU); g.fill();
  g.strokeStyle = '#e8d8b0'; g.lineWidth = 6; for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(-40, 20 + k * 40); g.lineTo(40, 40 + k * 40); g.stroke(); }
  g.fillStyle = '#2a3a58'; g.fillRect(-120, 180, 240, 400);                                            // the jeans
  g.strokeStyle = 'rgba(255,200,130,0.5)'; g.lineWidth = 5; g.beginPath(); g.ellipse(0, -10, 128, 300, 0, -1.2, 0.2); g.stroke();
  g.restore();
}

// ================================================================ the video board
// A straight-on LED board in its steel housing. content(g, w, h): draws into the board's own low-res canvas (one
// pixel per LED), shown through a round-dot mask. The board's words are drawn by the caller on the type layer.
export class Board {
  constructor(cols = 160, rows = 90) { this.cols = cols; this.rows = rows; this.lo = cv(cols, rows); this.lg = this.lo.getContext('2d'); this.big = cv(); this._mask = null; }
  mask(w, h, pitch) {
    const key = w + 'x' + h + ':' + pitch; if (this._mask && this._mask.key === key) return this._mask.c;
    const c = cv(pitch * 2, pitch * 2), g = c.getContext('2d'); const r = pitch * 0.42;
    for (const [x, y] of [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5], [1.5, 1.5]]) { const gr = g.createRadialGradient(x * pitch, y * pitch, 0, x * pitch, y * pitch, r); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, pitch * 2, pitch * 2); }
    this._mask = { key, c }; return c;
  }
  // draw the board at rect (x, y, w, h); content draws the low-res picture; o.src: a full-res picture instead (fan-cam)
  draw(g, x, y, w, h, content, { src = null, glow = 1, housing = true, pitch = null } = {}) {
    g.save();
    if (housing) { g.fillStyle = '#07080b'; rr(g, x - 26, y - 26, w + 52, h + 52, 10); g.fill();
      g.strokeStyle = 'rgba(255,226,190,0.28)'; g.lineWidth = 3; rr(g, x - 26, y - 26, w + 52, h + 52, 10); g.stroke();
      g.fillStyle = '#101218'; g.fillRect(x + w * 0.2, y + h + 26, 30, 300); g.fillRect(x + w * 0.8 - 30, y + h + 26, 30, 300); }
    const b = this.big.getContext('2d'); b.clearRect(0, 0, W, H);
    if (src) b.drawImage(src, x, y, w, h);
    else { const L = this.lg; L.clearRect(0, 0, this.cols, this.rows); content(L, this.cols, this.rows); b.imageSmoothingEnabled = false; b.drawImage(this.lo, x, y, w, h); }
    // the dot mask: each LED a round dot, the gaps near black
    const p = pitch || w / this.cols, m = this.mask(w, h, Math.max(3, Math.round(p)));
    b.globalCompositeOperation = 'destination-in'; b.fillStyle = b.createPattern(m, 'repeat'); b.save(); b.translate(x, y); b.fillRect(0, 0, w, h); b.restore(); b.globalCompositeOperation = 'source-over';
    g.fillStyle = '#020203'; g.fillRect(x, y, w, h);
    g.drawImage(this.big, 0, 0);
    if (glow) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35 * glow; g.filter = 'blur(10px)'; g.drawImage(this.big, 0, 0); g.filter = 'none'; g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
    g.restore();
  }
}
// the mascot race on the board: two grey costume mascots (an elephant, a donkey: generic, no party or team marks),
// running the sideline on 2-frame cycles; fold 0..1: on the kick both suits fold flat and empty, the heads still on
export function mascotRace(L, w, h, u, fold = 0, t = 0) {
  // the board's own race graphic: a dark title band on top (the prompt goes there), turf, the sideline, yard numbers off
  L.fillStyle = '#0a0f1a'; L.fillRect(0, 0, w, h);
  const top = h * 0.36;
  const gr = L.createLinearGradient(0, top, 0, h); gr.addColorStop(0, '#15441f'); gr.addColorStop(1, '#1f5a2a'); L.fillStyle = gr; L.fillRect(0, top, w, h - top);
  for (let i = 0; i < 12; i++) { const x = ((i * 40 - u * 140) % 480 + 480) % 480 - 40; L.fillStyle = 'rgba(0,0,0,0.12)'; L.fillRect(x, top, 20, h - top); }
  L.fillStyle = '#e8e8e0'; L.fillRect(0, top + 2, w, 2); L.fillRect(0, h - 10, w, 2);
  for (let i = 0; i < 6; i++) { const x = ((i * 80 - u * 140) % 480 + 480) % 480 - 40; L.fillRect(x, top + 2, 2, h - top - 10); }
  const ph = Math.floor(t * 12) % 2, gy = h - 14;
  mascot(L, w * 0.3 + u * w * 0.1, gy, 'elephant', ph, fold);
  mascot(L, w * 0.66 + u * w * 0.08, gy, 'donkey', 1 - ph, fold);
}
// a costume mascot (grey, generic, no party or team marks): the oversized head, a jersey, gloves, running legs.
// fold 0..1: the suit folds flat and empty on the turf, the head still on it (a pratfall, never a beheading)
function mascot(L, x, y, kind, ph, fold) {
  const f = ease.outCubic(fold), sq = 1 - 0.88 * f, grey = '#9a9a96', mid = '#76766f', dk = '#4a4a46', jer = '#c8c8c0';
  L.save(); L.translate(Math.round(x), Math.round(y));
  const s = ph ? 1 : -1;
  // legs (running: one forward, one back) and shoes
  if (f < 0.6) { L.strokeStyle = mid; L.lineWidth = 7; L.lineCap = 'round';
    L.beginPath(); L.moveTo(-4, -30 * sq); L.lineTo(-4 + 10 * s, -12 * sq); L.lineTo(-2 + 12 * s, 0); L.stroke();
    L.beginPath(); L.moveTo(4, -30 * sq); L.lineTo(4 - 9 * s, -14 * sq); L.lineTo(2 - 14 * s, -3); L.stroke();
    L.fillStyle = '#e8e8e0'; L.fillRect(-2 + 12 * s - 5, -3, 11, 4); L.fillRect(2 - 14 * s - 5, -6, 11, 4); }
  // the body in a plain jersey, squashing flat on the fold
  L.fillStyle = jer; L.beginPath(); L.ellipse(0, -44 * sq - 2 * f, 16 + 18 * f, 18 * sq + 2, 0, 0, TAU); L.fill();
  L.fillStyle = dk; L.fillRect(-16 - 18 * f, -46 * sq, 32 + 36 * f, 3);
  // arms pumping, white gloves
  if (f < 0.6) { L.strokeStyle = grey; L.lineWidth = 6; L.beginPath(); L.moveTo(-14, -54 * sq); L.lineTo(-22, -40 + 8 * s); L.stroke(); L.beginPath(); L.moveTo(14, -54 * sq); L.lineTo(24, -60 - 8 * s); L.stroke();
    L.fillStyle = '#f2f2ea'; L.beginPath(); L.arc(-22, -40 + 8 * s, 4, 0, TAU); L.arc(24, -60 - 8 * s, 4, 0, TAU); L.fill(); }
  // the head: big, soft, bobbing; it drops onto the flat suit but stays a head
  const hy = -84 * sq - 6 + 26 * f + (f < 0.1 ? (ph ? -2 : 1) : 0), hr = 22;
  if (kind === 'elephant') {
    L.fillStyle = mid; L.beginPath(); L.ellipse(-22, hy + 2, 14, 19, -0.3, 0, TAU); L.fill(); L.beginPath(); L.ellipse(22, hy + 2, 14, 19, 0.3, 0, TAU); L.fill();
    L.fillStyle = grey; L.beginPath(); L.arc(0, hy, hr, 0, TAU); L.fill();
    L.strokeStyle = grey; L.lineWidth = 8; L.lineCap = 'round'; L.beginPath(); L.moveTo(0, hy + 10); L.quadraticCurveTo(4, hy + 30, 14, hy + 30 - 6 * f); L.stroke();
  } else {
    L.fillStyle = mid; L.beginPath(); L.ellipse(-9, hy - 26, 5, 16, -0.2, 0, TAU); L.fill(); L.beginPath(); L.ellipse(9, hy - 26, 5, 16, 0.2, 0, TAU); L.fill();
    L.fillStyle = grey; L.beginPath(); L.ellipse(0, hy, hr * 0.8, hr, 0, 0, TAU); L.fill();
    L.fillStyle = '#b4b4ac'; L.beginPath(); L.ellipse(2, hy + 14, 13, 10, 0, 0, TAU); L.fill();
    L.fillStyle = dk; L.fillRect(-3, hy + 12, 2, 3); L.fillRect(5, hy + 12, 2, 3);
  }
  L.fillStyle = '#f4f4ee'; L.beginPath(); L.arc(-7, hy - 4, 5, 0, TAU); L.arc(7, hy - 4, 5, 0, TAU); L.fill();   // costume eyes
  L.fillStyle = '#141414'; L.beginPath(); L.arc(-6, hy - 3, 2.4, 0, TAU); L.arc(8, hy - 3, 2.4, 0, TAU); L.fill();
  if (f > 0.15) { L.fillStyle = `rgba(210,210,200,${0.7 * (1 - f)})`; for (let k = 0; k < 9; k++) L.fillRect(-40 + k * 10, -4 - (k % 3) * 3, 3, 3); }   // the thud's dust
  L.restore();
}

// ================================================================ the rim parapet against the night (MAKE ROOM.)
export function nightSky(g, y1, { glowX = 540, glow = 1, t = 0 } = {}) {
  const gr = g.createLinearGradient(0, 0, 0, y1); gr.addColorStop(0, '#070a14'); gr.addColorStop(0.7, '#141a2c'); gr.addColorStop(1, '#3a2c2a');
  g.fillStyle = gr; g.fillRect(0, 0, W, y1);
  const rg = g.createRadialGradient(glowX, y1, 10, glowX, y1, W * 0.9); rg.addColorStop(0, `rgba(255,170,90,${0.45 * glow})`); rg.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, y1);
}
export function parapet(g, y, h, { rail = true, k = 1 } = {}) {
  g.fillStyle = '#0c0e14'; g.fillRect(0, y, W, h);
  g.fillStyle = `rgba(255,220,170,${0.3 * k})`; g.fillRect(0, y, W, 3);
  if (rail) { g.strokeStyle = '#0c0e14'; g.lineWidth = 6; g.beginPath(); g.moveTo(0, y - h * 0.9); g.lineTo(W, y - h * 0.9); g.stroke();
    for (let x = 30; x < W; x += 110) { g.lineWidth = 5; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h * 0.9); g.stroke(); } }
}

// ================================================================ the four regions (b36-39): one crowd each, facing the
// stadium's glow on the horizon. Plates only (sky, land, the place's silhouette, its own lights); the ranks come after.
export function region(g, i, t, { horizon = 1180 } = {}) {
  const glowX = [640, 420, 560, 700][i];
  const gr = g.createLinearGradient(0, 0, 0, horizon); gr.addColorStop(0, '#060912'); gr.addColorStop(0.6, '#161a2a'); gr.addColorStop(1, ['#5a3424', '#4a2e28', '#6a3018', '#503a26'][i]);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const rg = g.createRadialGradient(glowX, horizon, 10, glowX, horizon, 700); rg.addColorStop(0, 'rgba(255,196,120,0.55)'); rg.addColorStop(1, 'rgba(255,160,90,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, horizon + 40);
  const r = rng(40 + i);
  g.fillStyle = '#07080c';
  if (i === 0) {        // ROWHOUSES: a block of attached two-storey rows, flat roofs, cornices, chimneys, antennas, lit windows
    let x = -20; while (x < W + 40) { const w = 120 + r() * 40, top = horizon - 220 - r() * 40;
      g.fillStyle = '#08090d'; g.fillRect(x, top, w, H); g.fillRect(x - 6, top - 14, w + 12, 16);
      if (r() < 0.6) g.fillRect(x + w * 0.7, top - 60, 18, 50);
      if (r() < 0.4) { g.strokeStyle = '#08090d'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + 30, top); g.lineTo(x + 30, top - 90); g.moveTo(x + 10, top - 70); g.lineTo(x + 50, top - 76); g.stroke(); }
      for (let fy = 0; fy < 2; fy++) for (let fx = 0; fx < 2; fx++) { if (r() < 0.35) continue; g.fillStyle = r() < 0.5 ? '#ffcf86' : '#e8a852'; g.fillRect(x + 22 + fx * (w * 0.45), top + 40 + fy * 90, 26, 44); }
      x += w; }
    streetlight(g, 160, horizon + 60, 1); streetlight(g, 900, horizon + 40, 0.8);
    ground(g, horizon + 60, '#15110e', '#0a0908');
  } else if (i === 1) { // A HEADFRAME TOWN: the hills, the steel headframe with its sheave wheel, company houses
    g.fillStyle = '#0a0b10'; g.beginPath(); g.moveTo(0, horizon - 120); for (let x = 0; x <= W; x += 40) g.lineTo(x, horizon - 120 - 90 * Math.sin(x / 260 + 1) - 40 * Math.sin(x / 90)); g.lineTo(W, H); g.lineTo(0, H); g.fill();
    g.strokeStyle = '#050608'; g.lineWidth = 12; const hx = 300, hy = horizon - 520;
    g.beginPath(); g.moveTo(hx - 110, horizon - 60); g.lineTo(hx, hy); g.lineTo(hx + 110, horizon - 60); g.moveTo(hx, hy); g.lineTo(hx + 190, horizon - 60); g.stroke();
    g.lineWidth = 5; for (let k = 1; k < 6; k++) { const yy = hy + k * 80; g.beginPath(); g.moveTo(hx - k * 20, yy); g.lineTo(hx + k * 20, yy); g.stroke(); }
    g.lineWidth = 8; g.beginPath(); g.arc(hx, hy - 10, 46, 0, TAU); g.stroke(); g.lineWidth = 3; for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(hx, hy - 10); g.lineTo(hx + 46 * Math.cos(k), hy - 10 + 46 * Math.sin(k)); g.stroke(); }
    g.fillStyle = '#ff3a2a'; g.beginPath(); g.arc(hx, hy - 64, 6, 0, TAU); g.fill();
    for (let k = 0; k < 7; k++) { const x = 480 + k * 90 + r() * 20, top = horizon - 90 - r() * 30; g.fillStyle = '#07080b'; g.fillRect(x, top, 80, 200); g.beginPath(); g.moveTo(x - 8, top); g.lineTo(x + 40, top - 40); g.lineTo(x + 88, top); g.fill();
      if (r() < 0.7) { g.fillStyle = '#ffc070'; g.fillRect(x + 30, top + 30, 20, 26); } }
    ground(g, horizon + 30, '#161310', '#0a0908');
  } else if (i === 2) { // A REFINERY under its flare: towers, a pipe rack, the flare stack burning; a catwalk rail in front
    for (let k = 0; k < 9; k++) { const x = 40 + k * 120 + r() * 40, hh = 200 + r() * 360, ww = 30 + r() * 60; g.fillStyle = '#07080c'; g.fillRect(x, horizon - hh, ww, hh + 400);
      g.fillStyle = '#ffb04a'; for (let l = 0; l < 4; l++) if (r() < 0.7) g.fillRect(x + ww / 2 - 2, horizon - hh + 20 + l * 70, 4, 4); }
    const fx = 820, fy = horizon - 720; g.fillStyle = '#07080c'; g.fillRect(fx - 10, fy, 20, 800);
    const fl = 1 + 0.15 * Math.sin(t * 23) + 0.1 * Math.sin(t * 37);
    const fg = g.createRadialGradient(fx, fy - 40, 4, fx, fy - 40, 160 * fl); fg.addColorStop(0, 'rgba(255,245,200,1)'); fg.addColorStop(0.25, 'rgba(255,170,60,0.9)'); fg.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = fg; g.beginPath(); g.ellipse(fx, fy - 50, 60 * fl, 120 * fl, 0.08 * Math.sin(t * 5), 0, TAU); g.fill();
    const hz = g.createRadialGradient(fx, fy, 10, fx, fy, 900); hz.addColorStop(0, 'rgba(255,140,50,0.35)'); hz.addColorStop(1, 'rgba(255,140,50,0)'); g.fillStyle = hz; g.fillRect(0, 0, W, H);
    g.fillStyle = '#06070a'; g.fillRect(0, horizon - 40, W, 30);                                   // the pipe rack
    ground(g, horizon + 200, '#12100e', '#08070a');
    g.strokeStyle = '#0a0b0f'; g.lineWidth = 10; g.beginPath(); g.moveTo(0, 1520); g.lineTo(W, 1500); g.moveTo(0, 1620); g.lineTo(W, 1600); g.stroke();   // the catwalk rails
    g.lineWidth = 7; for (let x = 20; x < W; x += 150) { g.beginPath(); g.moveTo(x, 1520 - x * 0.02); g.lineTo(x, 1780); g.stroke(); }
    g.strokeStyle = 'rgba(255,170,80,0.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 1515); g.lineTo(W, 1495); g.stroke();
  } else {              // A HARVEST CREW under field lights: the grain to the horizon, a combine, a light tower's beams
    ground(g, horizon, '#3a3018', '#140f08');
    g.strokeStyle = 'rgba(255,220,140,0.12)'; g.lineWidth = 2; for (let k = 0; k < 30; k++) { const y = horizon + k * k * 1.2 + 10; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + 6); g.stroke(); }
    g.fillStyle = '#07080b'; g.fillRect(140, horizon - 160, 260, 150); g.fillRect(120, horizon - 60, 320, 60); g.fillRect(380, horizon - 220, 90, 110); g.beginPath(); g.arc(200, horizon, 44, 0, TAU); g.arc(360, horizon, 60, 0, TAU); g.fill();
    g.fillRect(40, horizon - 60, 120, 20);                                                           // the header
    for (const [lx, lk] of [[180, 1], [420, 0.8]]) { const bg2 = g.createRadialGradient(lx, horizon - 150, 2, lx, horizon - 150, 120); bg2.addColorStop(0, `rgba(255,250,220,${lk})`); bg2.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = bg2; g.fillRect(lx - 130, horizon - 280, 260, 260); }
    const tx = 860; g.strokeStyle = '#07080b'; g.lineWidth = 8; g.beginPath(); g.moveTo(tx, horizon + 20); g.lineTo(tx, horizon - 420); g.stroke();
    g.fillStyle = '#07080b'; g.fillRect(tx - 60, horizon - 440, 120, 40);
    for (let k = 0; k < 4; k++) { const lx = tx - 45 + k * 30; g.fillStyle = '#fffbe8'; g.fillRect(lx - 8, horizon - 432, 16, 22);
      const beam = g.createLinearGradient(lx, horizon - 420, lx - 200, horizon + 400); beam.addColorStop(0, 'rgba(255,250,225,0.28)'); beam.addColorStop(1, 'rgba(255,250,225,0)');
      g.fillStyle = beam; g.beginPath(); g.moveTo(lx - 6, horizon - 420); g.lineTo(lx + 6, horizon - 420); g.lineTo(lx - 60 + k * 30, horizon + 500); g.lineTo(lx - 380 + k * 30, horizon + 500); g.fill(); }
  }
}
function ground(g, y, a, b) { const gr = g.createLinearGradient(0, y, 0, H); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, y, W, H - y); }
function streetlight(g, x, y, k) {
  g.strokeStyle = '#07080b'; g.lineWidth = 8; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 420); g.lineTo(x + 70, y - 440); g.stroke();
  const lg = g.createRadialGradient(x + 70, y - 430, 2, x + 70, y - 430, 260 * k); lg.addColorStop(0, 'rgba(255,190,100,0.9)'); lg.addColorStop(0.1, 'rgba(255,170,80,0.4)'); lg.addColorStop(1, 'rgba(255,150,60,0)');
  g.fillStyle = lg; g.fillRect(x - 300, y - 700, 700, 800);
}
// a phone held up in a raised fist: the flashlight side toward us (a hot point with a soft bloom), the body a dark sliver
export function phone(g, x, y, s, k = 1) {
  const r = Math.max(1.5, s);
  g.save(); g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(x, y, 0, x, y, r * 6); gr.addColorStop(0, `rgba(235,245,255,${0.9 * k})`); gr.addColorStop(0.2, `rgba(200,220,255,${0.35 * k})`); gr.addColorStop(1, 'rgba(200,220,255,0)');
  g.fillStyle = gr; g.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
  g.fillStyle = `rgba(255,255,255,${k})`; g.fillRect(x - r * 0.5, y - r * 0.5, r, r);
  g.restore();
}

// ================================================================ the card stunt (b41-44)
// The ACP emblem (gear, hammer and sickle, FOUR stripes running right) sampled onto a grid of seat cards seen from the
// blimp: cream cards, red cards, the aisles, phone light bleeding round the edges. state(t) -> each card's flip.
export class Cards {
  constructor(emblem, { cols = 84, rows = 64, seed = 5 } = {}) {
    this.cols = cols; this.rows = rows;
    const c = cv(cols, rows), g = c.getContext('2d'), ew = emblem.width, eh = emblem.height;
    // the emblem fills the grid with a margin, keeping its aspect (the stripes run to the right edge)
    const s = Math.min((cols - 6) / ew, (rows - 6) / eh), dw = ew * s, dh = eh * s;
    g.drawImage(emblem, (cols - dw) / 2, (rows - dh) / 2, dw, dh);
    const d = g.getImageData(0, 0, cols, rows).data, r = rng(seed);
    this.cells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const a = d[(y * cols + x) * 4 + 3] / 255, red = a > 0.45;
      this.cells.push({ x, y, red, t0: r() * 0.85, wrong: r() < 0.05, late: r() < 0.08, seed: r() }); }
    // the kid's card: one cell inside the second stripe, near its right end
    let best = null; for (const c2 of this.cells) if (c2.red && c2.x > cols * 0.62 && c2.x < cols * 0.8) { if (!best || Math.abs(c2.y - rows * 0.42) < Math.abs(best.y - rows * 0.42)) best = c2; }
    this.kid = best; best.kid = true;
  }
  // g, the grid's rect; u: 0 (b40.7, cards coming up) .. 1 (b42 locked); kid: 0 upside down .. 1 flipped red
  draw(g, x0, y0, w, h, u, kid, { t = 0, lock = 0, glowK = 1 } = {}) {
    const cw = w / this.cols, ch = h / this.rows;
    g.save();
    g.fillStyle = '#07080c'; g.fillRect(x0 - cw * 2, y0 - ch * 2, w + cw * 4, h + ch * 4);
    for (const c of this.cells) {
      const up = clamp((u - c.t0 * 0.6) / 0.25);                         // the card coming up (flip in from edge-on)
      if (up <= 0) { if (hash(c.seed * 99) < 0.5) phone(g, x0 + (c.x + 0.5) * cw, y0 + (c.y + 0.5) * ch, cw * 0.18, 0.7); continue; }
      let red = c.red;
      if (c.wrong && u < 0.93) red = !red;                                 // messy: a few wrong colours until the end
      if (c.late && u < 0.8) continue;                                     // late: still a hole
      if (c.kid) red = kid >= 0.5;
      const flip = c.kid ? Math.abs(Math.cos(clamp(kid) * Math.PI)) : ease.outCubic(up);
      const jx = (1 - lock) * (hash(c.seed * 7) - 0.5) * cw * 0.25, jy = (1 - lock) * (hash(c.seed * 13) - 0.5) * ch * 0.25, rot = (1 - lock) * (hash(c.seed * 17) - 0.5) * 0.25;
      const cx = x0 + (c.x + 0.5) * cw + jx, cy = y0 + (c.y + 0.5) * ch + jy, ww = cw * 0.9, hh = ch * 0.86 * Math.max(0.08, flip);
      g.save(); g.translate(cx, cy); g.rotate(rot);
      const lit = 0.85 + 0.15 * hash(c.seed * 3 + Math.floor(t * 8));
      g.fillStyle = red ? shade('#c8161c', lit) : shade('#f0e2c8', lit * (0.92 + 0.08 * hash(c.seed)));
      g.fillRect(-ww / 2, -hh / 2, ww, hh);
      g.restore();
    }
    // phone light bleeding round the card edges (cards lit from behind by flashlights)
    if (glowK) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.08 * glowK; g.fillStyle = '#fff4e0'; g.fillRect(x0, y0, w, h); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
    // the aisles: dark stair lines every 12 columns
    g.fillStyle = 'rgba(5,6,10,0.85)'; for (let k = 12; k < this.cols; k += 14) g.fillRect(x0 + k * cw - cw * 0.12, y0 - ch * 2, cw * 0.24, h + ch * 4);
    g.restore();
    return { kid: [x0 + (this.kid.x + 0.5) * cw, y0 + (this.kid.y + 0.5) * ch], cw, ch };
  }
}
// the kid's card, close: small hands (in silhouette, backlit by the phones) holding a card upside down, then flipped
export function kidCard(g, age, dur) {
  const u = clamp(age / dur), flip = ease.inOutCubic(clamp((u - 0.25) / 0.45));
  const bg = g.createRadialGradient(W / 2, H * 0.45, 20, W / 2, H * 0.45, H * 0.8); bg.addColorStop(0, '#2a2226'); bg.addColorStop(1, '#07070a');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // the neighbours' cards, out of focus, all red and cream around the hole
  g.save(); g.filter = 'blur(14px)';
  for (let k = 0; k < 14; k++) { const x = (k % 5) * 260 - 60, y = Math.floor(k / 5) * 520 + 120; if (k === 7) continue; g.fillStyle = k % 3 ? '#b8141a' : '#e8d8bc'; g.fillRect(x, y, 230, 170); }
  g.restore();
  // the card: cream side (upside down) turning over to red
  const cw = 560, chh = 400 * Math.max(0.06, Math.abs(Math.cos(flip * Math.PI))), red = flip > 0.5;
  g.save(); g.translate(W / 2, H * 0.47 + 30 * Math.sin(u * 6));
  g.fillStyle = red ? '#c8161c' : '#efe2c8'; g.fillRect(-cw / 2, -chh / 2, cw, chh);
  if (!red) { g.fillStyle = '#b8a888'; g.save(); g.scale(1, Math.max(0.06, Math.abs(Math.cos(flip * Math.PI))));   // the printed 'this side up' arrow, pointing down: upside down
    g.beginPath(); g.moveTo(-60, -120); g.lineTo(60, -120); g.lineTo(60, 20); g.lineTo(120, 20); g.lineTo(0, 150); g.lineTo(-120, 20); g.lineTo(-60, 20); g.closePath(); g.fill(); g.restore(); }
  g.strokeStyle = 'rgba(255,240,220,0.5)'; g.lineWidth = 3; g.strokeRect(-cw / 2, -chh / 2, cw, chh);
  // small hands in silhouette at the card's lower corners
  for (const s of [-1, 1]) { g.fillStyle = '#0c0a0c'; g.beginPath(); g.ellipse(s * (cw / 2 - 40), chh / 2 + 30, 70, 90, s * 0.3, 0, TAU); g.fill();
    for (let f = 0; f < 3; f++) { g.beginPath(); g.ellipse(s * (cw / 2 - 90 + f * 34), chh / 2 - 10, 16, 40, 0, 0, TAU); g.fill(); }
    g.strokeStyle = 'rgba(255,220,180,0.4)'; g.lineWidth = 3; g.beginPath(); g.ellipse(s * (cw / 2 - 40), chh / 2 + 30, 70, 90, s * 0.3, -2.4, -0.8); g.stroke(); }
  g.restore();
  // the phone behind: a hot point through the card's edge
  phone(g, W / 2 + 200, H * 0.47 - 230, 9, 0.9);
}
