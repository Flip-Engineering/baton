// THE MAJORITY v2: drawn pieces that are full-frame (not the board's pixels): the two sideline mascots (an elephant and a
// donkey, the same flat grey, no party colours, no marks) running and folding flat with their heads on.
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const outC = x => 1 - Math.pow(1 - clamp(x), 3);

function blob(g, x, y, rx, ry, rot, c0, c1, edge) {
  const gr = g.createRadialGradient(x - rx * 0.35, y - ry * 0.45, Math.min(rx, ry) * 0.1, x, y, Math.max(rx, ry) * 1.05);
  gr.addColorStop(0, c0); gr.addColorStop(1, c1);
  g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fill();
  if (edge) { g.strokeStyle = edge; g.lineWidth = Math.max(2, rx * 0.04); g.stroke(); }
}
function limb(g, pts, w, col, hi) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = '#1a1a1c'; g.lineWidth = w + 6; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
  g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
  if (hi) { g.strokeStyle = hi; g.lineWidth = w * 0.22; g.beginPath(); pts.forEach((p, i) => { const q = [p[0] - w * 0.2, p[1] - w * 0.2]; i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); }
}

// one costume mascot, feet at (x, y), S = pixels per metre-ish (height about 2.3 S in a stride), t seconds (stride),
// fold 0..1 (the kick: the suit goes flat and empty on the turf, the head stays on), dir +1 runs to the right
export function mascotBig(g, x, y, S, kind, t, fold, dir = 1) {
  const f = outC(fold), ph = t * 7.5 + (kind === 'donkey' ? 1.6 : 0), s = Math.sin(ph), c = Math.cos(ph);
  const grey = '#a6a6a2', mid = '#7c7c78', dk = '#46464a', jersey = '#d9d6cc', jersey2 = '#a9a79e';
  const bob = Math.abs(c) * 0.09 * S * (1 - f);
  g.save(); g.translate(x, y); g.scale(dir, 1);
  // the shadow on the turf
  g.fillStyle = 'rgba(0,0,0,0.38)'; g.beginPath(); g.ellipse(0, 6, S * (0.75 + 0.9 * f), S * 0.12, 0, 0, TAU); g.fill();
  const hipY = -S * 0.95 * (1 - 0.9 * f) - bob, shY = hipY - S * 0.8 * (1 - 0.93 * f);
  const lean = 0.18 * (1 - f);
  if (f < 0.99) {
    // legs in a stride
    const leg = (sg, back) => { const a = s * sg, kx = a * S * 0.32, fx = a * S * 0.55, lift = Math.max(0, -a * c * 0) ;
      limb(g, [[S * 0.08 * sg, hipY], [kx + S * 0.1, hipY * 0.5 - Math.max(0, a) * S * 0.22 * 0], [fx, -Math.max(0, -a) * S * 0.2]], S * 0.2 * (1 - f), back ? mid : grey, null);
      g.fillStyle = '#e9e8e2'; g.strokeStyle = '#1a1a1c'; g.lineWidth = 3; const px = fx + S * 0.12, py = -Math.max(0, -a) * S * 0.2;
      g.beginPath(); g.ellipse(px, py - S * 0.04, S * 0.22 * (1 - 0.4 * f), S * 0.09 * (1 - 0.8 * f), 0, 0, TAU); g.fill(); g.stroke(); };
    if (f < 0.5) { leg(-1, true); leg(1, false); }
    else for (const sg of [-1, 1]) {   // the empty suit's legs lie out limp on the turf, shoes at the ends
      limb(g, [[S * 0.25 * sg, hipY], [S * 0.8 * sg, -S * 0.04], [S * 1.2 * sg, -S * 0.04]], S * 0.17, sg < 0 ? mid : grey, null);
      g.fillStyle = '#e9e8e2'; g.strokeStyle = '#1a1a1c'; g.lineWidth = 3; g.beginPath(); g.ellipse(S * 1.32 * sg, -S * 0.05, S * 0.2, S * 0.08, 0, 0, TAU); g.fill(); g.stroke();
    }
  }
  // torso: a jersey, tapering; flattens into a pancake on the fold
  g.save(); g.translate(0, (hipY + shY) / 2); g.rotate(lean);
  const th = Math.abs(hipY - shY) / 2 + S * 0.04, tw = S * (0.42 + 0.95 * f);
  blob(g, 0, 0, tw, th, 0, jersey, jersey2, '#1a1a1c');
  g.fillStyle = 'rgba(40,40,46,0.8)'; g.fillRect(-tw * 0.96, -th * 0.12, tw * 1.92, th * 0.2 + 2);       // the plain hoop stripe
  g.restore();
  // arms: pumping; on the fold they lie out limp on the turf
  const arm = (sg) => {
    const sx = S * 0.4 * sg, sy = shY + S * 0.1 * (1 - f);
    if (f < 0.55) { const a = (sg > 0 ? s : -s); const ex = sx + S * 0.28 * sg + a * S * 0.2, ey = sy + S * 0.3 - Math.max(0, a) * S * 0.2, hx = ex + S * 0.2 * (sg > 0 ? 1 : -1) * 0.5 + a * S * 0.15, hy = ey - (sg > 0 ? S * 0.35 : -S * 0.05) + a * S * 0.15;
      limb(g, [[sx, sy], [ex, ey], [hx, hy]], S * 0.17, grey, null); blob(g, hx, hy, S * 0.14, S * 0.14, 0, '#fafaf4', '#cfcfc6', '#1a1a1c'); }
    else { const ex = sg * S * (0.9 + 0.5 * f), ey = hipY + S * 0.05; limb(g, [[sx * 1.6, hipY - S * 0.06], [ex, ey - S * 0.02], [ex + sg * S * 0.4, -S * 0.03]], S * 0.15, grey, null); blob(g, ex + sg * S * 0.48, -S * 0.07, S * 0.13, S * 0.1, 0, '#fafaf4', '#cfcfc6', '#1a1a1c'); }
  };
  arm(-1); arm(1);
  // the head: oversized, bobbing, then dropping onto the flat suit, tilted, still a head
  const hr = S * 0.62, hx = S * 0.12 * (1 - f) + f * S * (kind === 'elephant' ? -0.5 : 0.5), hy = shY - hr * 0.75 * (1 - f) + f * (-hr * 0.5) + (f < 0.1 ? -Math.abs(s) * S * 0.05 : 0), tilt = f * 0.45 + 0.05 * Math.sin(ph * 0.5);
  g.save(); g.translate(hx, hy); g.rotate(tilt);
  if (kind === 'elephant') {
    blob(g, -hr * 0.95, hr * 0.1, hr * 0.62, hr * 0.85, -0.25, '#8d8d89', '#5f5f5c', '#1a1a1c');      // ears
    blob(g, hr * 0.95, hr * 0.1, hr * 0.62, hr * 0.85, 0.25, '#8d8d89', '#5f5f5c', '#1a1a1c');
    blob(g, 0, 0, hr, hr * 0.95, 0, '#c2c2be', '#8a8a86', '#1a1a1c');
    limb(g, [[0, hr * 0.2], [hr * 0.18, hr * 0.85], [hr * 0.5, hr * 1.1 - f * hr * 0.2]], hr * 0.36, grey, 'rgba(255,255,255,0.35)');       // the trunk
    g.fillStyle = '#f4f2ea'; for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(sg * hr * 0.3, hr * 0.55); g.lineTo(sg * hr * 0.62, hr * 1.0); g.lineTo(sg * hr * 0.42, hr * 0.5); g.fill(); }
  } else {
    for (const sg of [-1, 1]) { blob(g, sg * hr * 0.32, -hr * 1.05, hr * 0.2, hr * 0.62, sg * 0.18, '#a2a29e', '#6a6a66', '#1a1a1c'); blob(g, sg * hr * 0.32, -hr * 1.05, hr * 0.09, hr * 0.42, sg * 0.18, '#c9a8a0', '#9a7a74', null); }
    blob(g, 0, 0, hr * 0.82, hr * 1.0, 0, '#c2c2be', '#8a8a86', '#1a1a1c');
    blob(g, hr * 0.12, hr * 0.55, hr * 0.5, hr * 0.38, 0, '#d6d6d0', '#a4a4a0', '#1a1a1c');       // the muzzle
    g.fillStyle = '#2a2a2c'; g.beginPath(); g.ellipse(hr * 0.02, hr * 0.5, hr * 0.06, hr * 0.045, 0, 0, TAU); g.ellipse(hr * 0.3, hr * 0.5, hr * 0.06, hr * 0.045, 0, 0, TAU); g.fill();
  }
  // costume eyes: big, white, a black pupil that looks ahead (the fold: they look at the lens)
  for (const sg of [-1, 1]) { const ex = sg * hr * 0.36 + hr * 0.1, ey = -hr * 0.18; blob(g, ex, ey, hr * 0.2, hr * 0.24, 0, '#ffffff', '#dcdcd2', '#1a1a1c');
    g.fillStyle = '#101012'; g.beginPath(); g.arc(ex + hr * (0.06 - 0.06 * f), ey + hr * 0.02, hr * 0.095, 0, TAU); g.fill(); }
  g.restore();
  // the dust of the fall
  if (f > 0.05) { const d = clamp((fold - 0.05) / 0.9); g.fillStyle = `rgba(215,215,205,${0.55 * (1 - d)})`; for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI, rr = S * (0.3 + 1.1 * d) * (0.7 + 0.3 * Math.sin(k * 7.1)); g.beginPath(); g.arc(Math.cos(a) * rr * 1.3 * (k % 2 ? 1 : -1), -S * 0.1 - Math.sin(a) * rr * 0.25, S * 0.12 * (1 + d), 0, TAU); g.fill(); } }
  g.restore();
}

// ================================================================ the card stunt, seen across the field
// A lit block of the stands as people holding cards up, in perspective (far rows small and high, near rows large): the ACP mark
// (gear, hammer and sickle, four stripes running east) sampled onto the grid. FOUR WAVES (left to right, a quarter of the
// bowl each) bring the cards up; a few are wrong or late until the lock; one hole (the kid's card) is upside down until it flips.
const hash = x => { x = Math.sin(x * 127.1 + 17.7) * 43758.5453; return x - Math.floor(x); };
export class CardStand {
  constructor(emblem, { cols = 60, rows = 46, seed = 5 } = {}) {
    this.cols = cols; this.rows = rows;
    const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows; const g = cv.getContext('2d');
    const s = Math.min((cols - 4) / emblem.width, (rows - 4) / emblem.height), dw = emblem.width * s, dh = emblem.height * s;
    g.drawImage(emblem, (cols - dw) / 2, (rows - dh) / 2, dw, dh);
    const d = g.getImageData(0, 0, cols, rows).data;
    this.cells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const a = d[(y * cols + x) * 4 + 3] / 255, h0 = hash(seed + x * 13.1 + y * 7.7);
      this.cells.push({ x, y, red: a > 0.45, w: Math.min(3, Math.floor(x / cols * 4)), j: hash(seed * 3 + x * 5.3 + y * 2.9), seed: h0, wrong: h0 < 0.035, late: h0 > 0.97 }); }
    let best = null; for (const c of this.cells) if (c.red && c.x > cols * 0.62 && c.x < cols * 0.8) { if (!best || Math.abs(c.y - rows * 0.42) < Math.abs(best.y - rows * 0.42)) best = c; }
    this.kid = best; best.kid = true;
  }
  // u: 0..1 the four waves (each a quarter of the climb); lock: 0..1 the cards settle square; kid: 0 upside down .. 1 red
  draw(g, X, Y, Wd, Ht, { u = 1, lock = 1, kid = 0, t = 0 } = {}) {
    const R = this.rows, C = this.cols, ch = Ht / R;
    const sOf = r => 0.8 + 0.2 * (r / R);                      // perspective: the far rows narrower
    g.save();
    for (let r = 0; r < R; r++) {
      const s = sOf(r), cw = Wd / C * s, rowY = Y + Ht * (r / R);
      for (const c of this.cells.slice(r * C, (r + 1) * C)) {
        const cx = X + Wd / 2 + (c.x - C / 2 + 0.5) * (Wd / C) * s, cy = rowY + ch * 0.55;
        const up = Math.max(0, Math.min(1, (u - c.w * 0.2 - c.j * 0.1) / 0.16));
        const kidc = c.kid;
        let red = c.red; if (c.wrong && lock < 0.9) red = !red;
        const late = c.late && lock < 0.8;
        const sh = 0.3 + 0.7 * hash(c.seed * 91);
        // the person: shoulders and head, lit from the front by the masts, warm rim from the phones behind the card
        const hr = cw * 0.3, sy = cy + ch * 0.5;
        g.fillStyle = `rgb(${24 + 40 * sh | 0},${26 + 34 * sh | 0},${34 + 46 * sh | 0})`; g.beginPath(); g.ellipse(cx, sy + hr * 0.9, cw * 0.46, hr * 1.1, 0, Math.PI, 0); g.fill();
        const skin = [[160, 112, 84], [112, 74, 52], [196, 150, 118], [78, 50, 36], [214, 172, 140]][Math.floor(hash(c.seed * 7) * 5)];
        g.fillStyle = `rgb(${skin[0] * 0.55 | 0},${skin[1] * 0.55 | 0},${skin[2] * 0.55 | 0})`; g.beginPath(); g.arc(cx, sy - hr * 0.1, hr, 0, TAU); g.fill();
        if (hash(c.seed * 11) < 0.35) { g.fillStyle = ['#e8e4d8', '#e0b020', '#c8641c'][Math.floor(hash(c.seed * 13) * 3)]; g.beginPath(); g.arc(cx, sy - hr * 0.35, hr * 1.02, Math.PI, 0); g.fill(); }   // hard hats
        if (up <= 0 || late) { if (hash(c.seed * 55) < 0.4) { g.fillStyle = 'rgba(210,225,255,0.9)'; g.fillRect(cx - 1, cy + ch * 0.1, 2, 2); } continue; }
        const flip = kidc ? Math.abs(Math.cos(Math.max(0, Math.min(1, kid)) * Math.PI)) : (1 - Math.pow(1 - up, 3));
        if (kidc && kid < 0.5) red = false; else if (kidc) red = true;
        const jx = (1 - lock) * (hash(c.seed * 7) - 0.5) * cw * 0.5, jy = (1 - lock) * (hash(c.seed * 13) - 0.5) * ch * 0.5, rot = (1 - lock) * (hash(c.seed * 17) - 0.5) * 0.35;
        const ww = cw * 0.92, hh = ch * 0.92 * Math.max(0.1, flip);
        g.save(); g.translate(cx + jx, cy - ch * 0.15 + jy); g.rotate(rot);
        const lit = 0.82 + 0.18 * hash(c.seed * 3 + Math.floor(t * 8));
        g.fillStyle = red ? `rgb(${230 * lit | 0},${28 * lit | 0},${34 * lit | 0})` : `rgb(${246 * lit | 0},${232 * lit | 0},${204 * lit | 0})`;
        g.fillRect(-ww / 2, -hh / 2, ww, hh);
        g.restore();
        if (up < 1) { g.fillStyle = `rgba(255,240,215,${0.5 * (1 - up)})`; g.fillRect(cx - ww / 2, cy - ch * 0.15 - hh / 2, ww, 1.5); }
      }
    }
    g.restore();
    const r = this.kid.y, s = sOf(r), rowY = Y + Ht * (r / R);
    return { kid: [X + Wd / 2 + (this.kid.x - C / 2 + 0.5) * (Wd / C) * s, rowY + ch * 0.4] };
  }
}
