// FRONTIER (v6, newsreel): GARY / MAGNITKA. Sepia archive with gate weave, scratches, sprockets and
// silent-film intertitles. Gary, Indiana: steel city. Copied at Magnitogorsk, 1931: ten years, not
// fifty. Electrify everything. Rail. Concrete. The moon in eight years. Then the film burns out.
// Snap to colour: Gary, 2036, a blue-white arc furnace. The pour. The machine runs hot. Ours. Arriving.
import { W, H, C, loadFonts, loadBeats, clamp, lerp, ease, rng, line, Finish, sigil, closer, outCanvas } from '../lib/kit.js';

const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('frontier2');
const finish = new Finish(1906);
const SERIF = 'DejaVu Serif', CREAM = '#efe4c8';
const sc = document.createElement('canvas'); sc.width = W; sc.height = H; const g = sc.getContext('2d');

// ---------------------------------------------------------------- the shots (drawn in colour into g; the archive grade comes after)
function sparks(cx, cy, t, n, spread, col) {
  const r = rng(7);
  for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (r() - 0.5) * spread, v = 300 + r() * 700, ph = (t * (0.8 + r()) + r()) % 1;
    const x = cx + Math.cos(a) * v * ph, y = cy + Math.sin(a) * v * ph + 900 * ph * ph;
    g.fillStyle = col; g.fillRect(x, y, 4, 4 + 10 * (1 - ph)); }
}
function furnace(t, x0, w, mirror, hot = '#ffb040') {           // a mill interior: the ladle tips, the stream falls, sparks fly
  g.save(); g.beginPath(); g.rect(x0, 0, w, H); g.clip();
  g.fillStyle = '#1a120c'; g.fillRect(x0, 0, w, H);
  const cx = x0 + w / 2;
  for (let k = 0; k < 7; k++) { g.fillStyle = `rgba(90,70,50,${0.25 + k * 0.05})`; g.fillRect(x0 + (mirror ? w - 60 - k * 90 : k * 90), 300 - k * 20, 40, 1400); }   // girders
  g.fillStyle = '#2a1c12'; g.fillRect(x0, 1380, w, 540);
  const tip = 0.35 + 0.1 * Math.sin(t * 0.8);
  g.save(); g.translate(cx + (mirror ? 160 : -160), 640); g.rotate(mirror ? -tip : tip);
  g.fillStyle = '#0d0907'; g.beginPath(); g.moveTo(-150, -140); g.lineTo(150, -140); g.lineTo(120, 170); g.lineTo(-120, 170); g.fill(); g.restore();
  const sx = cx + (mirror ? 60 : -60), grd = g.createLinearGradient(sx - 40, 0, sx + 40, 0);
  grd.addColorStop(0, 'rgba(255,160,40,0)'); grd.addColorStop(0.5, '#fff4d0'); grd.addColorStop(1, 'rgba(255,160,40,0)');
  g.fillStyle = grd; g.fillRect(sx - 40, 700, 80, 720);
  const glow = g.createRadialGradient(sx, 1420, 20, sx, 1420, 700); glow.addColorStop(0, hot); glow.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = glow; g.fillRect(x0, 700, w, 1220);
  sparks(sx, 1400, t, 140, 2.2, '#ffe6a0');
  g.fillStyle = '#060403'; const wx = cx + (mirror ? -250 : 250);                  // a worker in silhouette, arm raised
  g.beginPath(); g.arc(wx, 1150, 34, 0, 7); g.fill(); g.fillRect(wx - 50, 1185, 100, 260); g.fillRect(wx - 45, 1445, 36, 200); g.fillRect(wx + 9, 1445, 36, 200);
  g.save(); g.translate(wx + (mirror ? -40 : 40), 1200); g.rotate(mirror ? 0.9 : -0.9); g.fillRect(-12, -180, 24, 180); g.restore();
  g.restore();
}
function pylons(t) {                                           // electrification: towers marching over the plain, lines singing
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#6d6a62'); sky.addColorStop(0.6, '#c9c3b2'); sky.addColorStop(1, '#3a342c');
  g.fillStyle = sky; g.fillRect(0, 0, W, H); g.fillStyle = '#2a251e'; g.fillRect(0, 1250, W, H - 1250);
  g.strokeStyle = '#141210'; g.lineWidth = 3;
  const pts = [];
  for (let k = 7; k >= 0; k--) { const z = ((k + (t * 0.6) % 1)), s = 1.6 / (0.3 + z * 0.55), x = W * 0.62 - 700 / (0.8 + z) + 240, base = 1250 + 400 / (0.6 + z);
    const h = 900 * s * 0.45, hw = 120 * s * 0.45; pts.push([x, base - h]);
    g.lineWidth = Math.max(1, 4 * s * 0.4); g.beginPath();
    g.moveTo(x - hw, base); g.lineTo(x, base - h); g.lineTo(x + hw, base);
    for (let j = 1; j < 6; j++) { const yy = base - h * j / 6, ww = hw * (1 - j / 6); g.moveTo(x - ww, yy); g.lineTo(x + ww, yy - h / 12); g.moveTo(x + ww, yy); g.lineTo(x - ww, yy - h / 12); }
    g.moveTo(x - hw * 1.3, base - h * 0.8); g.lineTo(x + hw * 1.3, base - h * 0.8); g.stroke(); }
  g.lineWidth = 2; g.strokeStyle = 'rgba(20,18,16,0.8)';
  for (const off of [-0.8, 0, 0.8]) { g.beginPath(); pts.forEach(([x, y], i) => { const xx = x + off * 60, yy = y + 90; i ? g.quadraticCurveTo((pts[i - 1][0] + xx) / 2 + off * 20, (pts[i - 1][1] + yy) / 2 + 60, xx, yy) : g.moveTo(xx, yy); }); g.stroke(); }
}
function loco(t, kick) {                                         // the iron horse charging the camera down converging rails
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#48443c'); sky.addColorStop(1, '#bdb6a2');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.fillStyle = '#2e2922'; g.beginPath(); g.moveTo(0, 1050); g.lineTo(W, 1050); g.lineTo(W, H); g.lineTo(0, H); g.fill();
  g.strokeStyle = '#d8d0bc'; g.lineWidth = 6;
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(W / 2 + s * 20, 1050); g.lineTo(W / 2 + s * 700, H); g.stroke(); }
  for (let k = 0; k < 14; k++) { const z = ((k + t * 3) % 14) / 14, y = 1050 + (H - 1050) * z * z, hw = 20 + 700 * z * z; g.lineWidth = 3 + 14 * z; g.strokeStyle = '#1a1612'; g.beginPath(); g.moveTo(W / 2 - hw * 1.2, y); g.lineTo(W / 2 + hw * 1.2, y); g.stroke(); }
  const u = (t * 0.35) % 1, s2 = 0.5 + u * 1.6, y0 = 1050 + 200 * u;
  for (let k = 0; k < 16; k++) { const a = k / 16; g.fillStyle = `rgba(30,28,26,${0.5 - a * 0.3})`; g.beginPath(); g.arc(W / 2 + Math.sin(t * 2 + k) * 60 * a, y0 - 420 * s2 - k * 60 * s2, (60 + k * 20) * s2, 0, 7); g.fill(); }
  g.fillStyle = '#0a0907'; g.save(); g.translate(W / 2, y0); g.scale(s2, s2);
  g.fillRect(-190, -330, 380, 330); g.beginPath(); g.arc(0, -330, 190, Math.PI, 0); g.fill(); g.fillRect(-60, -620, 120, 170);
  g.beginPath(); g.moveTo(-230, 0); g.lineTo(0, 140); g.lineTo(230, 0); g.fill();
  g.fillStyle = '#fff6d8'; g.beginPath(); g.arc(0, -380, 55 + 8 * kick, 0, 7); g.fill(); g.restore();
}
function dam(t) {                                               // concrete: the wall, the spillway, the scale of it
  g.fillStyle = '#56504a'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#8b8378'; g.beginPath(); g.moveTo(-100, 300); g.quadraticCurveTo(W / 2, 520, W + 100, 300); g.lineTo(W + 100, 1700); g.quadraticCurveTo(W / 2, 1500, -100, 1700); g.fill();
  g.strokeStyle = 'rgba(40,36,32,0.6)'; g.lineWidth = 2;
  for (let k = 0; k < 26; k++) { const y = 360 + k * 52; g.beginPath(); g.moveTo(-100, y); g.quadraticCurveTo(W / 2, y + 220 - k * 4, W + 100, y); g.stroke(); }
  for (let k = 0; k < 4; k++) { const x = 180 + k * 240, v = g.createLinearGradient(0, 400, 0, 1800); v.addColorStop(0, 'rgba(240,236,224,0.9)'); v.addColorStop(1, 'rgba(240,236,224,0.2)');
    g.fillStyle = v; g.fillRect(x, 440 + Math.sin(t * 7 + k) * 6, 70, 1400);
    for (let j = 0; j < 20; j++) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + ((j * 37 + t * 300) % 70), 440 + ((j * 131 + t * 900) % 1400), 3, 30); } }
  g.fillStyle = 'rgba(230,226,214,0.6)'; g.fillRect(0, 1720, W, 200);
}
function rocket(t, kick) {                                       // the moon shot: plume and a white column rising
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#15161a'); sky.addColorStop(1, '#a9a393');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  const rise = (t * 0.12) % 1, y = 1100 - rise * 500;
  for (let k = 0; k < 40; k++) { const a = k / 40; g.fillStyle = `rgba(235,230,215,${0.7 - a * 0.5})`; g.beginPath(); g.arc(W / 2 + Math.sin(k * 1.7 + t) * 200 * a, y + 480 + k * 30, 90 + k * 14, 0, 7); g.fill(); }
  const f = g.createLinearGradient(0, y + 300, 0, y + 700); f.addColorStop(0, '#fffbe8'); f.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = f; g.beginPath(); g.moveTo(W / 2 - 60, y + 300); g.lineTo(W / 2 + 60, y + 300); g.lineTo(W / 2 + 20 + 30 * kick, y + 760); g.lineTo(W / 2 - 20 - 30 * kick, y + 760); g.fill();
  g.fillStyle = '#e9e5da'; g.fillRect(W / 2 - 55, y - 520, 110, 820); g.beginPath(); g.moveTo(W / 2 - 55, y - 520); g.lineTo(W / 2, y - 700); g.lineTo(W / 2 + 55, y - 520); g.fill();
  g.fillStyle = '#1b1a18'; for (const yy of [-380, -120, 120]) g.fillRect(W / 2 - 55, y + yy, 110, 26);
}
function mill2036(t, kick) {                                    // the rolling mill: a white-hot slab riding the rollers at the camera
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#070b14'); bg.addColorStop(1, '#141c2c');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 18; k++) { const z = ((k + t * 2.4) % 18) / 18, y = 820 + 1100 * z * z, hw = 60 + 520 * z * z;
    g.fillStyle = '#2b3446'; g.fillRect(W / 2 - hw, y, hw * 2, 6 + 24 * z); }
  const u = (t * 0.5) % 1, y = 820 + 1100 * u * u, hw = 50 + 440 * u * u, hh = 14 + 160 * u * u;
  const sl = g.createLinearGradient(0, y - hh, 0, y); sl.addColorStop(0, '#fff8e0'); sl.addColorStop(1, '#ff8a20');
  g.fillStyle = sl; g.fillRect(W / 2 - hw, y - hh, hw * 2, hh);
  const glow = g.createRadialGradient(W / 2, y - hh / 2, 10, W / 2, y - hh / 2, 500 + 400 * u); glow.addColorStop(0, 'rgba(255,170,60,0.55)'); glow.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  sparks(W / 2, y - hh, t, 90, 2.4, '#ffe0a0');
  for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(90,130,190,0.35)'; g.fillRect(60 + k * 190, 150, 12, 700); }
}
function arc2036(t, kick) {                                      // Gary, 2036: the electric-arc furnace, in full colour
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#060a14'); bg.addColorStop(1, '#101828');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 9; k++) { g.fillStyle = 'rgba(80,120,170,0.25)'; g.fillRect(40 + k * 120, 200, 16, 1500); }
  const cx = W / 2, cy = 1000;
  g.fillStyle = '#1c2230'; g.beginPath(); g.ellipse(cx, cy + 260, 380, 120, 0, 0, 7); g.fill(); g.fillRect(cx - 380, cy + 260, 760, 400);
  for (const dx of [-110, 0, 110]) { g.fillStyle = '#394356'; g.fillRect(cx + dx - 24, 300, 48, cy - 300 + 180); }
  const f = 0.7 + 0.3 * Math.sin(t * 40) * Math.sin(t * 23) + 0.3 * kick;
  const glow = g.createRadialGradient(cx, cy + 220, 10, cx, cy + 220, 700); glow.addColorStop(0, `rgba(230,245,255,${f})`); glow.addColorStop(0.3, `rgba(120,190,255,${0.6 * f})`); glow.addColorStop(1, 'rgba(40,80,160,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.strokeStyle = `rgba(240,250,255,${f})`; g.lineWidth = 3;
  for (const dx of [-110, 0, 110]) { g.beginPath(); let x = cx + dx, y = cy + 180; g.moveTo(x, y); for (let s = 0; s < 6; s++) { x += (Math.sin(t * 60 + s * 7 + dx) * 18); y += 14; g.lineTo(x, y); } g.stroke(); }
  sparks(cx, cy + 240, t, 180, 2.8, '#e8f4ff');
  g.fillStyle = '#0a0e16'; const wx = 190;                                           // a worker in a visor
  g.beginPath(); g.arc(wx, 1300, 36, 0, 7); g.fill(); g.fillRect(wx - 52, 1338, 104, 280); g.fillStyle = 'rgba(140,210,255,0.8)'; g.fillRect(wx - 26, 1290, 52, 16);
}

// ---------------------------------------------------------------- the archive grade: sepia, weave, flicker, scratches, sprockets
function grade(t, frame, colour, burn) {
  const r = rng(frame * 7 + 1), wx = (r() - 0.5) * 6, wy = (r() - 0.5) * 8;
  ctx.fillStyle = '#0a0806'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(wx, wy);
  ctx.filter = colour ? 'contrast(1.1) saturate(1.2)' : `sepia(0.85) contrast(1.35) brightness(${0.9 + 0.12 * r()})`;
  ctx.drawImage(sc, 0, 0); ctx.filter = 'none'; ctx.restore();
  if (!colour) {
    ctx.strokeStyle = 'rgba(240,230,200,0.35)'; ctx.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) if (r() < 0.6) { const x = r() * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (r() - 0.5) * 20, H); ctx.stroke(); }
    ctx.fillStyle = 'rgba(20,14,8,0.6)'; for (let k = 0; k < 14; k++) { ctx.beginPath(); ctx.arc(r() * W, r() * H, 1 + r() * 4, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#050403'; ctx.fillRect(0, 0, 54, H); ctx.fillRect(W - 54, 0, 54, H);                    // sprockets riding the frame
    ctx.fillStyle = '#c8bca0'; const o = (t * 240) % 120;
    for (let y = -120 + o; y < H; y += 120) { ctx.fillRect(14, y, 26, 60); ctx.fillRect(W - 40, y, 26, 60); }
  }
  if (burn > 0) {                                                // the film burns through from the centre
    const rr = burn * 1400, gb = ctx.createRadialGradient(W / 2, H / 2, rr * 0.6, W / 2, H / 2, rr);
    gb.addColorStop(0, 'rgba(0,0,0,1)'); gb.addColorStop(0.7, 'rgba(255,140,40,0.95)'); gb.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = gb; ctx.fillRect(0, 0, W, H);
  }
}
function intertitle(text, age, full) {                            // a silent-film card: ornate border, serif caps
  const a = clamp(age / 0.06);
  if (full) { ctx.fillStyle = `rgba(8,6,4,${a})`; ctx.fillRect(0, 0, W, H); }
  const y = full ? 1000 : 1560, bh = full ? 420 : 250, bw = W - 150;
  if (!full) { ctx.fillStyle = `rgba(8,6,4,${0.82 * a})`; ctx.fillRect(75, y - bh / 2 - 40, bw, bh); }
  ctx.strokeStyle = `rgba(239,228,200,${a})`; ctx.lineWidth = 3; ctx.strokeRect(95, y - bh / 2 - 20, bw - 40, bh - 40);
  ctx.lineWidth = 1; ctx.strokeRect(108, y - bh / 2 - 7, bw - 66, bh - 66);
  for (const [x, yy] of [[95, y - bh / 2 - 20], [W - 95, y - bh / 2 - 20], [95, y + bh / 2 - 60], [W - 95, y + bh / 2 - 60]]) { ctx.beginPath(); ctx.arc(x, yy, 10, 0, 7); ctx.fillStyle = CREAM; ctx.fill(); }
  line(ctx, text, W / 2, y + (full ? 30 : 10), { family: SERIF, weight: 'bold', size: full ? 230 : 120, color: CREAM, alpha: a, maxW: bw - 140 });
}

const WORDS = [[0, 'THE IRON', 0], [1, 'IS HOT.', 0], [3, null], [4, 'GARY, 1906.', 1], [6, 'STEEL CITY.', 0], [8, null],
  [12, 'THE TEMPO', 0], [16, 'RISES.', 0], [18, null], [20, '30,000 WORKERS.', 0], [23, null],
  [28, 'THE TEMPO', 0], [32, 'RISES.', 0], [34, 'THIRTY STATIONS.', 0], [37, null],
  [40, 'EVERY MILL', 0], [42, 'MOVES.', 0], [44, null], [48, 'RISES.', 0], [50, null],
  [52, 'THEY WILL', 0], [54, 'NEVER PACE', 0], [56, 'OUR FRONTIER.', 0], [58, 'CLASS STRUGGLE.', 0], [61, null],
  [64, 'TOO HOT', 0], [65, 'FOR THE', 0], [66, 'OLD WAY.', 0], [68, 'THE ONLY', 0], [69, 'OPPORTUNITY.', 0], [70, 'DARE I SAY', 0], [71, 'REVOLUTIONARY.', 0],
  [72, 'STRIKE.', 0], [74, 'WITH GRIT.', 0], [75, 'PLANNING.', 0], [76, 'TECHNOLOGY.', 0],
  [78, 'THE IRON?', 0], [79, 'HOT.', 0], [80, 'THE WORKERS?', 0], [81, 'READY.', 0], [82, 'THE HOUR?', 0], [83, 'NOW.', 0], [84, 'STRIKE.', 0], [86, null],
  [88, 'THE STEEL POURS.', 0], [90, 'NOTHING LESS', 0], [91, 'THAN ALL', 0], [92, 'THAT EXISTS.', 0], [94, null],
  [96, 'GARY, 2036.', 0], [100, null]];
const at = (list, b) => { let q = list[0]; for (const x of list) if (b >= x[0]) q = x; return q; };

window.renderFrame = async (t) => {
  const b = B.beat(t), frame = Math.round(t * 30);
  if (b >= 104) { closer(ctx, (b - 104) * B.spb); finish.apply(ctx, frame, { grain: 0.06, vignette: 0.6 }); return; }
  const kick = B.env('kick', t, 9), imp = B.env('impact', t, 5);
  const colour = b >= 72;
  g.save(); const z = 1 + 0.05 * kick + 0.1 * imp; g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2);
  if (b < 16) furnace(t, 0, W, false);
  else if (b < 32) { const split = ease.outExpo(clamp((b - 16) / 1.5));                     // Gary | Magnitka: the same pour, mirrored
    furnace(t, 0, lerp(W, W / 2, split), false); if (split > 0) furnace(t + 0.3, lerp(W, W / 2, split), W / 2, true, '#ff7040');
    g.fillStyle = '#0a0806'; g.fillRect(lerp(W, W / 2, split) - 4, 0, 8, H); }
  else if (b < 40) pylons(t);
  else if (b < 48) loco(t, kick);
  else if (b < 56) furnace(t * 1.8, 0, W, false);                                   // the mill at double speed (no dam: §5.2 New Deal guard); governor snaps on PACE
  else if (b < 64) rocket(t, kick);
  else if (b < 72) { furnace(t * 0.2, 0, W, false, '#553018'); }
  else if (b < 100) { const k = Math.floor((b - 72) / 2) % 4;
    if (k === 1) mill2036(t, kick); else if (k === 2) { g.translate(W / 2, 1240); g.scale(1.7, 1.7); g.translate(-W / 2, -1240); arc2036(t, kick); } else if (k === 3) mill2036(t + 1.3, kick); else arc2036(t, kick); }
  else { arc2036(t, kick); }
  g.restore();
  grade(t, frame, colour, b >= 66 && b < 72 ? clamp((b - 66) / 5) : 0);
  if (b >= 100) { const u = ease.outExpo(clamp((b - 100) / 1)); ctx.fillStyle = `rgba(6,8,14,${0.7 * u})`; ctx.fillRect(0, 0, W, H);
    sigil(ctx, W / 2, 860, 220 * lerp(1.4, 1, u), { color: CREAM, accent: C.red2, alpha: u, tagline: true }); }
  const w = at(WORDS, b);
  if (w[1] && b >= w[0] && b < 100) intertitle(w[1], (b - w[0]) * B.spb, w[2]);
  const flash = (b >= 72 && b < 72.3 ? 1 - (b - 72) * 3.3 : 0) + (b >= 16 && b < 16.2 ? 0.6 : 0);
  finish.apply(ctx, frame, { grain: colour ? 0.06 : 0.14, vignette: colour ? 0.6 : 0.95, flash });
};
window.sceneReady = true;
