// CLOSER c1 lab: ?mode=sheet|flaps|stamp|decal|beam ; renderFrame(t) with t = age in seconds (sheet ignores it)
import { W, H, C, loadFonts, outCanvas, acpEmblem, sigil, BRAND, tinted, line } from '../lib/kit.js';
import { drawMark, drawLockup, RED, CLOSERS, markBox } from '../lib/closer.js';
const ctx = outCanvas(); await loadFonts();
const mode = new URLSearchParams(location.search).get('mode') || 'sheet';
function sheet() {
  ctx.fillStyle = '#f4efe4'; ctx.fillRect(0, 0, W, H / 2); ctx.fillStyle = '#120708'; ctx.fillRect(0, H / 2, W, H / 2);
  line(ctx, 'RASTER (old)', 260, 60, { family: 'Archivo Black', size: 36, color: '#222' }); line(ctx, 'VECTOR (new)', 800, 60, { family: 'Archivo Black', size: 36, color: '#222' });
  const E = BRAND.acp_emblem;
  // 1:1 big, at 2.6x (the raster upscaled as scenes did it)
  const sz = 330, w = E.width * sz / E.height;
  ctx.drawImage(tinted(E, RED), 260 - w / 2, 110, w, sz); drawMark(ctx, 800, 110 + sz / 2, sz, { color: RED });
  let y = 520;
  for (const s of [128, 64, 32]) { const wr = E.width * s / E.height; ctx.drawImage(tinted(E, RED), 260 - wr / 2, y, wr, s); drawMark(ctx, 800, y + s / 2, s, { color: RED }); y += s + 30; }
  // lockup raster vs vector at 150
  const L = BRAND.acc_lockup, lh = 150, lw = L.width * lh / L.height; y = 920;
  ctx.drawImage(tinted(L, '#1b1a1c'), 540 - lw / 2 - 0, 0 + 0, 0, 0);
  ctx.drawImage(tinted(L, '#1b1a1c'), 260 - lw / 2 * 0.5 - 60, y - 60, lw * 0.5, lh * 0.5); drawLockup(ctx, 800, y - 60 + lh * 0.25, lh * 0.5, { color: '#1b1a1c', accent: RED });
  // dark half: the four stripes as parts, then red mark, then 2.6x crop of the gear's teeth
  const s2 = 260; for (let k = 0; k <= 4; k++) drawMark(ctx, 110 + k * 215, H / 2 + 170, 150, { color: RED, badge: k >= 0 ? 1 : 0, stripes: [0, 1, 2, 3].map(i => i < k ? 1 : i === k ? 0.5 : 0) });
  drawMark(ctx, 540, H / 2 + 520, 600, { color: RED });
  const g = markBox(540, H / 2 + 520, 600); ctx.fillStyle = '#fff'; line(ctx, 'vector at 600 px (the old raster was 235 px source)', 540, H / 2 + 780, { family: 'Archivo Black', size: 30, color: '#bbb' });
  // 3x crop of a gear tooth region from both
  const Y0 = H / 2 + 840, S = 7.5;
  ctx.save(); ctx.beginPath(); ctx.rect(60, Y0, 460, 300); ctx.clip(); ctx.drawImage(tinted(E, RED), 60 - 45 * S, Y0 - 100 * S, E.width * S, E.height * S); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(560, Y0, 460, 300); ctx.clip(); drawMark(ctx, 560 - 45 * S + 190 * S, Y0 - 100 * S + 117.5 * S, 235 * S, { color: RED }); ctx.restore();
  line(ctx, 'raster, 7.5x', 290, H / 2 + 1170, { family: 'Archivo Black', size: 28, color: '#bbb' }); line(ctx, 'vector, 7.5x', 790, H / 2 + 1170, { family: 'Archivo Black', size: 28, color: '#bbb' });
}
function bg(age) {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a0b0b'); g.addColorStop(0.55, '#b8431f'); g.addColorStop(1, '#2b0c08'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const s = ctx.createRadialGradient(540, 700, 20, 540, 700, 320); s.addColorStop(0, '#ffcf6a'); s.addColorStop(0.6, '#ff6a2a'); s.addColorStop(1, 'rgba(255,60,20,0)'); ctx.fillStyle = s; ctx.fillRect(0, 300, W, 800);
}
window.renderFrame = async t => {
  if (mode === 'sheet') return sheet();
  if (mode === 'flaps') { ctx.fillStyle = '#0a0102'; ctx.fillRect(0, 0, W, H); if (t < 0) { drawMark(ctx, 540, 900, 520, { color: RED }); return; } CLOSERS.flaps(ctx, t); }
  if (mode === 'stamp') { bg(); CLOSERS.stamp(ctx, t); }
  if (mode === 'decal') { ctx.fillStyle = '#1a2038'; ctx.fillRect(0, 0, W, H); const g = ctx.createRadialGradient(540, 1500, 50, 540, 1500, 800); g.addColorStop(0, '#c9a36a'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 900, W, 1000); CLOSERS.decal(ctx, t); }
  if (mode === 'beam') { bg(); CLOSERS.beam(ctx, t); }
};
window.sceneReady = true;
