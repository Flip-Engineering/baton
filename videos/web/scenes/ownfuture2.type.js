// OWN THE FUTURE v6: the type lives in the world. Every line is painted, stencilled, printed, lit or reflected on a
// surface that belongs to the night haul (gantry and post signs, pavement legends, container sides, a billboard, a
// variable-message sign, a canopy lightbox, a banner, a painted warehouse wall, crane steel, a ship's hull, a flyer, a
// CB faceplate). Each art function returns { c, m, aspect, cap, span }: the face art (RGB), a letter mask (white =
// type: drives the retroreflective / backlit response), the face aspect (w / h) and the fitted type's cap height and
// width as fractions of the face height and width (the 150 px floor is checked from these at render time).
import { clamp, rng, BRAND, tinted } from '../lib/kit.js';

const cv = (w, h) => { const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); return c; };
const FONT = { hw: (s) => `900 ${s}px "Overpass"`, anton: (s) => `400 ${s}px "Anton"`, arch: (s) => `400 ${s}px "Archivo Black"`, spartan: (s) => `900 ${s}px "League Spartan"`, mono: (s) => `700 ${s}px "Plex Mono"` };

// fit one line into a box: largest size whose cap height <= capMax and width <= wMax
function fit(g, text, face, wMax, capMax) {
  let s = 400; g.font = face(s);
  const capOf = () => { const m = g.measureText('H'); return m.actualBoundingBoxAscent; };
  const k = capOf() / s;                       // cap height per px of font size
  s = capMax / k; g.font = face(s);
  const w = g.measureText(text).width; if (w > wMax) { s *= wMax / w; g.font = face(s); }
  return { size: s, cap: capOf(), w: g.measureText(text).width };
}
function noiseSpecks(g, w, h, n, seed, rgba) { const R = rng(seed); g.fillStyle = rgba; for (let i = 0; i < n; i++) { const r = 0.5 + R() * R() * 5; g.beginPath(); g.ellipse(R() * w, R() * h, r, r * (0.5 + R()), R() * 3, 0, 6.28); g.fill(); } }
function streaks(g, w, h, n, seed, rgba, fromTop = true) { const R = rng(seed); for (let i = 0; i < n; i++) { const x = R() * w, l = h * (0.1 + R() * 0.5), y0 = fromTop ? R() * h * 0.3 : h - l;
  const gr = g.createLinearGradient(0, y0, 0, y0 + l); gr.addColorStop(0, rgba); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x, y0, 2 + R() * 10, l); } }
// the stencil cut: bridges through the counters, the way a sign-writer's plate holds its islands
function stencilCut(g, text, x0, base, size, cap) {
  g.save(); g.globalCompositeOperation = 'destination-out'; let x = x0; const bw = Math.max(3, cap * 0.075);
  for (const ch of text) { const w = g.measureText(ch).width;
    if ('OQ0D'.includes(ch)) g.fillRect(x + w * 0.5 - bw / 2, base - cap * 1.1, bw, cap * 1.25);
    if ('BPR'.includes(ch)) g.fillRect(x + w * 0.36 - bw / 2, base - cap * 1.1, bw, cap * 1.25);
    if ('A4'.includes(ch)) g.fillRect(x + w * 0.5 - bw / 2, base - cap * 1.1, bw, cap * 0.45);
    if ('689'.includes(ch)) g.fillRect(x + w * 0.5 - bw / 2, base - cap * 1.1, bw, cap * 1.25);
    x += w; }
  g.restore();
}
function drawLine(g, m, text, x, base, fill, maskFill = '#fff') { g.fillStyle = fill; g.fillText(text, x, base); if (m) { m.fillStyle = maskFill; m.fillText(text, x, base); } }

// ------------------------------------------------------------------ faces
const ART = {
  // retroreflective highway green (the gantry grammar): Overpass on sign green, white border, bolts, bead grain
  green(text, { tab = null } = {}) {
    const g0 = cv(8, 8).getContext('2d'), H = 520, top = tab ? 150 : 0;
    const f = fit(g0, text, FONT.hw, 2400, 250), W = Math.max(900, f.w + 220);
    const c = cv(W, H + top), m = cv(W, H + top), g = c.getContext('2d'), mg = m.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H + top);
    g.fillStyle = '#0b6b3a'; g.beginPath(); g.roundRect(0, top, W, H, 30); g.fill();
    if (tab) { const tw = 900; g.beginPath(); g.roundRect(W - tw - 40, 0, tw, top + 30, 20); g.fill();
      g.strokeStyle = '#f2f4ee'; g.lineWidth = 9; g.beginPath(); g.roundRect(W - tw - 28, 12, tw - 24, top - 10, 14); g.stroke();
      g.font = FONT.hw(96); g.textAlign = 'center'; g.fillStyle = '#f2f4ee'; g.fillText(tab, W - tw / 2 - 40, top - 34); mg.font = FONT.hw(96); mg.textAlign = 'center'; mg.fillStyle = '#fff'; mg.fillText(tab, W - tw / 2 - 40, top - 34); g.textAlign = mg.textAlign = 'left'; }
    const gr = g.createLinearGradient(0, top, 0, top + H); gr.addColorStop(0, 'rgba(255,255,255,0.07)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = gr; g.fillRect(0, top, W, H);
    noiseSpecks(g, W, H + top, W * 2, 11, 'rgba(0,0,0,0.12)'); streaks(g, W, H + top, 26, 12, 'rgba(20,14,8,0.28)', false);
    g.strokeStyle = '#f2f4ee'; g.lineWidth = 14; g.beginPath(); g.roundRect(20, top + 20, W - 40, H - 40, 20); g.stroke();
    mg.strokeStyle = '#fff'; mg.lineWidth = 14; mg.beginPath(); mg.roundRect(20, top + 20, W - 40, H - 40, 20); mg.stroke();
    g.font = mg.font = FONT.hw(f.size); const base = top + H / 2 + f.cap / 2;
    drawLine(g, mg, text, (W - f.w) / 2, base, '#f2f4ee');
    for (const [x, y] of [[50, top + 50], [W - 50, top + 50], [50, top + H - 50], [W - 50, top + H - 50]]) { g.fillStyle = '#9aa39c'; g.beginPath(); g.arc(x, y, 10, 0, 6.28); g.fill(); }
    return { c, m, aspect: W / (H + top), cap: f.cap / (H + top), span: f.w / W };
  },
  // a 14 x 48 ft bulletin: pasted paper panels, cream ground, red rule, black condensed type; lit from four goosenecks
  billboard(text) {
    const W = 2400, H = 700, c = cv(W, H), m = cv(W, H), g = c.getContext('2d'), mg = m.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H);
    g.fillStyle = '#e9e2cf'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#c0161a'; g.fillRect(0, H - 120, W, 120); g.fillRect(0, 0, W, 34);
    // the four-stripe ACP emblem in the red band corner
    const E = BRAND.acp_emblem, eh = 96; g.drawImage(tinted(E, '#f4ecd8'), 40, H - 108, E.width * eh / E.height, eh);
    g.font = FONT.hw(62); g.fillStyle = '#f4ecd8'; g.fillText('ACP.US', W - 300, H - 38);
    const f = fit(g, text, FONT.anton, W - 160, 440); g.font = mg.font = FONT.anton(f.size);
    const base = (H - 120 + 34) / 2 + f.cap / 2; drawLine(g, mg, text, (W - f.w) / 2, base, '#111');
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 3; for (let x = W / 8; x < W; x += W / 8) { g.beginPath(); g.moveTo(x + Math.sin(x) * 4, 0); g.lineTo(x, H); g.stroke(); }  // paper seams
    g.beginPath(); g.moveTo(0, H / 2 + 6); g.lineTo(W, H / 2 - 4); g.stroke();
    noiseSpecks(g, W, H, 3000, 21, 'rgba(60,40,20,0.10)'); streaks(g, W, H, 40, 22, 'rgba(40,30,20,0.22)', true);
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 26; g.strokeRect(0, 0, W, H);
    return { c, m, aspect: W / H, cap: f.cap / H, span: f.w / W };
  },
  // a variable-message sign: black louvred face, amber LED matrix (the dots are the type)
  vms(text) {
    const rows = 17, P = 20, g0 = cv(8, 8).getContext('2d'); g0.font = FONT.hw(15); const tw0 = g0.measureText(text).width;
    const cols = Math.max(40, Math.ceil(tw0) + 8), W = cols * P + 120, H = rows * P + 120;
    const c = cv(W, H), m = cv(W, H), g = c.getContext('2d'), mg = m.getContext('2d');
    g.fillStyle = '#0b0c0d'; g.fillRect(0, 0, W, H); mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H);
    g.strokeStyle = '#2a2d30'; g.lineWidth = 20; g.strokeRect(10, 10, W - 20, H - 20);
    // rasterise the line at the matrix resolution: an 11-dot cap height, the dots nearly touching (legible, still LEDs)
    const s = cv(cols, rows), sg = s.getContext('2d'); sg.fillStyle = '#000'; sg.fillRect(0, 0, cols, rows);
    sg.font = FONT.hw(15); sg.fillStyle = '#fff'; sg.fillText(text, (cols - tw0) / 2, rows - 3);
    const d = sg.getImageData(0, 0, cols, rows).data;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const v = d[(y * cols + x) * 4] / 255, on = v > 0.35, cx = 60 + x * P + P / 2, cy = 60 + y * P + P / 2;
      g.fillStyle = on ? '#ffb020' : '#1c1a16'; g.beginPath(); g.arc(cx, cy, P * (on ? 0.47 : 0.34), 0, 6.28); g.fill();
      if (on) { mg.fillStyle = '#fff'; mg.beginPath(); mg.arc(cx, cy, P * 0.5, 0, 6.28); mg.fill(); } }
    return { c, m, aspect: W / H, cap: (11 * P) / H, span: tw0 * P / W };
  },
  // the long side of a 40 ft box: ribs, corner castings, owner code, rust, and a sign-writer's white stencil
  container(text, { livery = '#7a1f22', ink = '#f1ede2' } = {}) {
    const W = 2600, H = 560, c = cv(W, H), m = cv(W, H), g = c.getContext('2d'), mg = m.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H);
    g.fillStyle = livery; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 26) { const gr = g.createLinearGradient(x, 0, x + 26, 0); gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.0)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0.06)'); g.fillStyle = gr; g.fillRect(x, 0, 26, H); }
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, W, 22); g.fillRect(0, H - 26, W, 26);
    for (const x of [0, W - 60]) { g.fillStyle = '#2a2622'; g.fillRect(x, 0, 60, 60); g.fillRect(x, H - 60, 60, 60); }
    streaks(g, W, H, 70, 31, 'rgba(90,40,12,0.35)', true); noiseSpecks(g, W, H, 2500, 32, 'rgba(30,14,6,0.2)');
    g.font = FONT.hw(40); g.fillStyle = 'rgba(240,236,226,0.85)'; g.fillText('ACPU 203 620 [4]', 90, 90); g.fillText('45G1', 90, 140);
    const f = fit(g, text, FONT.arch, W - 320, 330); g.font = mg.font = FONT.arch(f.size); const x = (W - f.w) / 2, base = H / 2 + f.cap / 2 + 10;
    const L = cv(W, H), lg = L.getContext('2d'); lg.font = FONT.arch(f.size); lg.shadowColor = 'rgba(240,236,226,0.45)'; lg.shadowBlur = 14; lg.fillStyle = ink; lg.fillText(text, x, base);   // overspray
    stencilCut(lg, text, x, base, f.size, f.cap); g.drawImage(L, 0, 0); mg.fillStyle = '#fff'; mg.fillText(text, x, base); stencilCut(mg, text, x, base, f.size, f.cap);
    const R = rng(text.length * 7 + 3); g.fillStyle = ink; for (let i = 0; i < 26; i++) { const dx = x + R() * f.w, l = 20 + R() * 110; g.fillRect(dx, base - 4, 3 + R() * 3, l); g.beginPath(); g.arc(dx + 2.5, base + l, 4, 0, 6.28); g.fill(); }  // drips
    g.save(); g.globalCompositeOperation = 'multiply'; noiseSpecks(g, W, H, 1600, 34, 'rgba(120,70,40,0.5)'); g.restore();   // chipped paint
    return { c, m, aspect: W / H, cap: f.cap / H, span: f.w / W };
  },
  // a trailer roof seen from the air: white aluminium, roof bows, black roof letters (the way fleets number their roofs)
  roof(text) {
    const W = 2600, H = 560, c = cv(W, H), m = cv(W, H), g = c.getContext('2d'), mg = m.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H); g.fillStyle = '#c9ccc8'; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 58) { g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(x, 0, 4, H); }
    streaks(g, W, H, 60, 41, 'rgba(40,40,40,0.18)', true); noiseSpecks(g, W, H, 2400, 42, 'rgba(20,20,20,0.12)');
    const f = fit(g, text, FONT.arch, W - 260, 380); g.font = mg.font = FONT.arch(f.size);
    { const L = cv(W, H), lg = L.getContext('2d'); lg.font = FONT.arch(f.size); lg.fillStyle = '#101112'; lg.fillText(text, (W - f.w) / 2, H / 2 + f.cap / 2); stencilCut(lg, text, (W - f.w) / 2, H / 2 + f.cap / 2, f.size, f.cap); g.drawImage(L, 0, 0);
      mg.fillStyle = '#fff'; mg.fillRect(0, 0, W, H); mg.fillStyle = '#000'; mg.fillText(text, (W - f.w) / 2, H / 2 + f.cap / 2); }
    return { c, m, aspect: W / H, cap: f.cap / H, span: f.w / W };
  },
  // reflective warning sign: black on yellow, with its flasher beacons (drawn in the world as lights)
  warning(text) {
    const g0 = cv(8, 8).getContext('2d'), f0 = fit(g0, text, FONT.hw, 2000, 230), W = f0.w + 200, H = 440;
    const c = cv(W, H), m = cv(W, H), g = c.getContext('2d'), mg = m.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H); g.fillStyle = '#f2c21a'; g.beginPath(); g.roundRect(0, 0, W, H, 28); g.fill();
    mg.fillStyle = '#fff'; mg.beginPath(); mg.roundRect(0, 0, W, H, 28); mg.fill();          // the whole face is prismatic sheeting
    noiseSpecks(g, W, H, W * 2, 51, 'rgba(90,60,0,0.14)');
    g.strokeStyle = '#111'; g.lineWidth = 18; g.beginPath(); g.roundRect(22, 22, W - 44, H - 44, 18); g.stroke();
    g.font = FONT.hw(f0.size); g.fillStyle = '#111'; g.fillText(text, (W - f0.w) / 2, H / 2 + f0.cap / 2);
    mg.font = FONT.hw(f0.size); mg.fillStyle = '#000'; mg.fillText(text, (W - f0.w) / 2, H / 2 + f0.cap / 2);
    streaks(g, W, H, 18, 52, 'rgba(60,40,10,0.25)', false);
    return { c, m, aspect: W / H, cap: f0.cap / H, span: f0.w / W, dark: true };
  },
  // regulatory white: black on white reflective sheeting
  white(text) {
    const g0 = cv(8, 8).getContext('2d'), f0 = fit(g0, text, FONT.hw, 2000, 230), W = f0.w + 180, H = 420;
    const c = cv(W, H), m = cv(W, H), g = c.getContext('2d'), mg = m.getContext('2d');
    g.fillStyle = '#eceee8'; g.beginPath(); g.roundRect(0, 0, W, H, 22); g.fill(); mg.fillStyle = '#fff'; mg.beginPath(); mg.roundRect(0, 0, W, H, 22); mg.fill();
    noiseSpecks(g, W, H, W * 2, 61, 'rgba(40,40,30,0.10)');
    g.strokeStyle = '#111'; g.lineWidth = 16; g.beginPath(); g.roundRect(20, 20, W - 40, H - 40, 14); g.stroke();
    g.font = mg.font = FONT.hw(f0.size); g.fillStyle = '#111'; g.fillText(text, (W - f0.w) / 2, H / 2 + f0.cap / 2); mg.fillStyle = '#000'; mg.fillText(text, (W - f0.w) / 2, H / 2 + f0.cap / 2);
    streaks(g, W, H, 22, 62, 'rgba(50,40,20,0.25)', false);
    return { c, m, aspect: W / H, cap: f0.cap / H, span: f0.w / W, dark: true };
  },
  // canopy fascia lightbox at the port gate: red acrylic, white letters lit from inside
  lightbox(text) {
    const W = 2600, H = 460, c = cv(W, H), m = cv(W, H), g = c.getContext('2d'), mg = m.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#8a0d10'); gr.addColorStop(0.5, '#b3121a'); gr.addColorStop(1, '#6a0a0c'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let x = 180; x < W; x += 360) { const lg = g.createLinearGradient(x - 90, 0, x + 90, 0); lg.addColorStop(0, 'rgba(255,120,90,0)'); lg.addColorStop(0.5, 'rgba(255,120,90,0.16)'); lg.addColorStop(1, 'rgba(255,120,90,0)'); g.fillStyle = lg; g.fillRect(x - 90, 0, 180, H); }  // tube banding
    const f = fit(g, text, FONT.hw, W - 240, 290); g.font = mg.font = FONT.hw(f.size);
    drawLine(g, mg, text, (W - f.w) / 2, H / 2 + f.cap / 2, '#fff6ea');
    g.fillStyle = '#16181a'; g.fillRect(0, 0, W, 26); g.fillRect(0, H - 26, W, 26);
    noiseSpecks(g, W, H, 1500, 71, 'rgba(0,0,0,0.12)');
    return { c, m, aspect: W / H, cap: f.cap / H, span: f.w / W, lit: true };
  },
  // a hand-painted warehouse wall: block brick, cream sign-writer letters with a red shade, floodlit from goosenecks
  wall(text) {
    const W = 2600, H = 820, c = cv(W, H), m = cv(W, H), g = c.getContext('2d'), mg = m.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H); g.fillStyle = '#4a3a30'; g.fillRect(0, 0, W, H);
    const R = rng(81);
    for (let y = 0; y < H; y += 40) for (let x = (y / 40) % 2 ? -60 : 0; x < W; x += 120) { const k = 0.8 + R() * 0.35; g.fillStyle = `rgb(${86 * k},${66 * k},${54 * k})`; g.fillRect(x + 3, y + 3, 114, 34); }
    const f = fit(g, text, FONT.spartan, W - 300, 380); g.font = mg.font = FONT.spartan(f.size); const x = (W - f.w) / 2, base = H / 2 + f.cap / 2;
    g.fillStyle = '#a3171a'; g.fillText(text, x + 16, base + 16);
    drawLine(g, mg, text, x, base, '#efe4c8');
    g.save(); g.globalCompositeOperation = 'multiply'; for (let y = 0; y < H; y += 40) { g.fillStyle = 'rgba(40,30,24,0.6)'; g.fillRect(0, y, W, 3); } g.restore();   // mortar through the paint
    noiseSpecks(g, W, H, 5000, 82, 'rgba(60,44,36,0.5)'); streaks(g, W, H, 60, 83, 'rgba(20,14,10,0.3)', true);
    return { c, m, aspect: W / H, cap: f.cap / H, span: f.w / W };
  },
  // v7: a painted mural across the warehouse's long wall, two lines (MILLIONS / BY 2036.), sign-writer's Anton in cream
  // over a red drop plate on brick; the word block spans ~90 % of the wall so a square-on camera gets it at 70 % width
  mural(text) {
    const W = 2800, H = 1040, c = cv(W, H), m = cv(W, H), g = c.getContext('2d'), mg = m.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H); g.fillStyle = '#4a3a30'; g.fillRect(0, 0, W, H);
    const R = rng(81);
    for (let y = 0; y < H; y += 40) for (let x = (y / 40) % 2 ? -60 : 0; x < W; x += 120) { const k = 0.8 + R() * 0.35; g.fillStyle = `rgb(${86 * k},${66 * k},${54 * k})`; g.fillRect(x + 3, y + 3, 114, 34); }
    const words = text.split(' '), L = words.length > 2 ? [words[0], words.slice(1).join(' ')] : [text];
    const fs = L.map(l => fit(g, l, FONT.anton, W - 260, L.length > 1 ? 400 : 560)); const cap = Math.min(...fs.map(f => f.cap)), gap = cap * 0.34;
    let base = H / 2 - (L.length * cap + (L.length - 1) * gap) / 2 + cap; let span = 0;
    L.forEach((l, i) => { const f = fit(g, l, FONT.anton, W - 260, cap); g.font = mg.font = FONT.anton(f.size); const x = (W - f.w) / 2;
      g.fillStyle = '#a3171a'; g.fillText(l, x + 14, base + 14); drawLine(g, mg, l, x, base, '#efe4c8'); span = Math.max(span, f.w); base += cap + gap; });
    g.save(); g.globalCompositeOperation = 'multiply'; for (let y = 0; y < H; y += 40) { g.fillStyle = 'rgba(40,30,24,0.55)'; g.fillRect(0, y, W, 3); } g.restore();
    noiseSpecks(g, W, H, 5000, 82, 'rgba(60,44,36,0.45)'); streaks(g, W, H, 60, 83, 'rgba(20,14,10,0.28)', true);
    return { c, m, aspect: W / H, cap: cap / H, span: span / W };
  },
  // painted on crane steel: white letters on the boom girder's red flank, weld seams and bolt rows
  crane(text) {
    const W = 2600, H = 420, c = cv(W, H), m = cv(W, H), g = c.getContext('2d'), mg = m.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H); g.fillStyle = '#a92c1c'; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 325) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, 0, 6, H); for (let y = 30; y < H; y += 44) { g.fillStyle = 'rgba(255,220,200,0.25)'; g.beginPath(); g.arc(x + 20, y, 6, 0, 6.28); g.fill(); } }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, W, 18); g.fillRect(0, H - 18, W, 18);
    const f = fit(g, text, FONT.hw, W - 260, 270); g.font = mg.font = FONT.hw(f.size); drawLine(g, mg, text, (W - f.w) / 2, H / 2 + f.cap / 2, '#f4efe6');
    streaks(g, W, H, 50, 91, 'rgba(60,20,8,0.35)', true); noiseSpecks(g, W, H, 2500, 92, 'rgba(40,10,4,0.25)');
    return { c, m, aspect: W / H, cap: f.cap / H, span: f.w / W };
  },
  // a container ship's hull: black plating, weld seams, draft marks, white letters as tall as a house
  hull(text) {
    const W = 4096, H = 620, c = cv(W, H), m = cv(W, H), g = c.getContext('2d'), mg = m.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1a2024'); gr.addColorStop(1, '#0c0f11'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#6a1c16'; g.fillRect(0, H - 60, W, 60); g.fillStyle = '#2a2e30'; g.fillRect(0, 0, W, 14);          // boot topping, deck edge
    for (let x = 0; x < W; x += 130) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, 14, 3, H - 74); } for (let y = 70; y < H - 60; y += 110) { g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(0, y, W, 3); }
    streaks(g, W, H, 160, 101, 'rgba(120,60,20,0.3)', true);
    noiseSpecks(g, W, H, 4000, 102, 'rgba(0,0,0,0.25)');
    const f = fit(g, text, FONT.anton, W * 0.47, H * 0.5); g.font = mg.font = FONT.anton(f.size); drawLine(g, mg, text, (W - f.w) / 2, (H - 60) / 2 + f.cap / 2 + 4, '#fbfaf4');
    for (const [x0, x1] of [[0, 400], [W, W - 400]]) { const eg = g.createLinearGradient(x0, 0, x1, 0); eg.addColorStop(0, 'rgba(8,10,12,1)'); eg.addColorStop(1, 'rgba(8,10,12,0)'); g.fillStyle = eg; g.fillRect(Math.min(x0, x1), 0, 400, H); }
    return { c, m, aspect: W / H, cap: f.cap / H, span: f.w / W };
  },
  // the organisers' banner: Party red cloth, cream hand-cut letters sewn on (opaque: they go dark with the light behind)
  banner(text) {
    const W = 2400, H = 640, c = cv(W, H), m = cv(W, H), g = c.getContext('2d'), mg = m.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H); g.fillStyle = '#b3141a'; g.fillRect(0, 0, W, H);
    const R = rng(111); for (let y = 0; y < H; y += 3) { g.fillStyle = `rgba(0,0,0,${0.03 + R() * 0.04})`; g.fillRect(0, y, W, 1); }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, W, 30); g.fillRect(0, H - 30, W, 30);
    const f = fit(g, text, FONT.anton, W - 220, 400); g.font = mg.font = FONT.anton(f.size);
    drawLine(g, mg, text, (W - f.w) / 2, H / 2 + f.cap / 2, '#efe4c8');
    for (const x of [30, W - 30]) for (const y of [30, H - 30]) { g.fillStyle = '#c8c2b0'; g.beginPath(); g.arc(x, y, 12, 0, 6.28); g.fill(); }
    return { c, m, aspect: W / H, cap: f.cap / H, span: f.w / W };
  },
  // pavement legend: road paint, letters stretched along the direction of travel (the way SLOW or BUS is painted),
  // worn through by traffic. mask = paint; drawn into the ground shader so it takes the asphalt's light and wet.
  pave(text, { stretch = 1.15 } = {}) {
    const W = 2400, H = 1100, c = cv(W, H), g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.font = FONT.anton(200); const w0 = g.measureText(text).width, cap0 = g.measureText('H').actualBoundingBoxAscent;
    const sx = (W - 80) / w0, sy = Math.min((H - 60) / cap0, sx * stretch);
    g.save(); g.translate(W / 2 - w0 * sx / 2, H / 2 + cap0 * sy / 2); g.scale(sx, sy); g.fillStyle = '#fff'; g.fillText(text, 0, 0); g.restore();
    g.save(); g.globalCompositeOperation = 'multiply'; const R = rng(text.length + 121);
    for (let i = 0; i < 9000; i++) { const v = Math.floor(120 + R() * 135); g.fillStyle = `rgb(${v},${v},${v})`; const r = 1 + R() * R() * 9; g.fillRect(R() * W, R() * H, r, r * 0.6); }
    for (const x of [W * 0.32, W * 0.68]) { const gr = g.createLinearGradient(x - 120, 0, x + 120, 0); gr.addColorStop(0, 'rgb(255,255,255)'); gr.addColorStop(0.5, 'rgb(150,150,150)'); gr.addColorStop(1, 'rgb(255,255,255)'); g.fillStyle = gr; g.fillRect(x - 120, 0, 240, H); }   // wheel paths
    g.restore();
    return { c, m: c, aspect: W / H, cap: cap0 * sy / H, span: w0 * sx / W };
  },
};
export function faceArt(kind, text, o) { return ART[kind](text, o || {}); }

// ------------------------------------------------------------------ 2D in-world objects (foreground, drawn into the comp)
// the flyer handed up to the cab (cycle 6: a union sign-up for the port's drayage drivers, handed out by Party organisers,
// per @ACPMain '100s of truckers signed up to unionize'; not a Party membership form): offset-printed, cream stock, the four-stripe emblem, a crease, sodium light raking it
export function flyerArt(text) {
  const W = 1180, H = 820, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = '#efe8d6'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#c0161a'; g.fillRect(0, 0, W, 190);
  const E = BRAND.acp_emblem, eh = 140; g.drawImage(tinted(E, '#f4ecd8'), 40, 25, E.width * eh / E.height, eh);
  g.font = FONT.hw(64); g.fillStyle = '#f4ecd8'; g.fillText('ACP.US', W - 300, 120);
  const f = fit(g, text, FONT.anton, W - 90, 330); g.font = FONT.anton(f.size); g.fillStyle = '#121212'; g.fillText(text, (W - f.w) / 2, 190 + (H - 190 - 140) / 2 + f.cap / 2);
  g.fillStyle = '#c0161a'; g.fillRect(40, H - 110, W - 80, 14); g.font = FONT.hw(38); g.fillStyle = '#222'; g.fillText('PORT NEWARK DRAYAGE DRIVERS · UNION SIGN-UP', 40, H - 40);
  const cr = g.createLinearGradient(W * 0.48, 0, W * 0.54, 0); cr.addColorStop(0, 'rgba(0,0,0,0)'); cr.addColorStop(0.5, 'rgba(0,0,0,0.16)'); cr.addColorStop(0.52, 'rgba(255,255,255,0.2)'); cr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = cr; g.fillRect(0, 0, W, H);
  noiseSpecks(g, W, H, 2500, 131, 'rgba(90,70,40,0.08)');
  return { c, cap: f.cap / H, span: f.w / W };
}
// the CB radio faceplate in macro: brushed steel, knobs, a wide amber LCD (14-segment feel via Plex Mono)
export function cbArt(text) {
  const W = 1300, H = 520, c = cv(W, H), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#3a3e42'); gr.addColorStop(0.5, '#1c1f22'); gr.addColorStop(1, '#0c0d0e'); g.fillStyle = gr; g.beginPath(); g.roundRect(0, 0, W, H, 40); g.fill();
  const R = rng(141); for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(255,255,255,${0.012 + R() * 0.02})`; g.fillRect(0, y, W, 1); }
  g.fillStyle = '#050606'; g.beginPath(); g.roundRect(40, 60, W - 80, 300, 20); g.fill();
  const lg = g.createLinearGradient(0, 80, 0, 340); lg.addColorStop(0, '#2a1a06'); lg.addColorStop(1, '#1a1004'); g.fillStyle = lg; g.beginPath(); g.roundRect(60, 80, W - 120, 260, 12); g.fill();
  const f = fit(g, text, FONT.mono, W - 170, 150); g.font = FONT.mono(f.size);
  g.fillStyle = 'rgba(255,160,40,0.08)'; g.fillText('8'.repeat(text.length), (W - f.w) / 2, 210 + f.cap / 2);       // ghost segments
  g.save(); g.shadowColor = '#ffa020'; g.shadowBlur = 24; g.fillStyle = '#ffb43a'; g.fillText(text, (W - f.w) / 2, 210 + f.cap / 2); g.restore();
  g.font = FONT.mono(40); g.fillStyle = '#ff8a20'; g.fillText('CH 19', 90, 130); g.fillText('TX', W - 170, 130);
  for (const [x, r] of [[160, 58], [400, 58], [W - 400, 58], [W - 160, 58]]) { const kg = g.createRadialGradient(x - 15, 440 - 15, 5, x, 440, r); kg.addColorStop(0, '#5a5e62'); kg.addColorStop(1, '#0e0f10'); g.fillStyle = kg; g.beginPath(); g.arc(x, 440, r * 0.9, 0, 6.28); g.fill(); }
  return { c, cap: f.cap / H, span: f.w / W };
}
