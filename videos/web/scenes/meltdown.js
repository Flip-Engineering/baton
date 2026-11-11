// MELTDOWN (v6): CORE. A cross-section of the world. Capital's search runs down through the
// strata of the index and ignites a core: the machine. Profit hits zero; the superstructure
// freezes around it, a temple locked in ice. It won't hold. The core melts down through
// ice, bedrock, magma, history; the section flips and it rises as the dawn over a lit
// American mill town. Neo-China arrives from the future, internal to America. 2036.
import { W, H, C, loadFonts, loadBeats, clamp, lerp, ease, rng, line, Finish, closer, outCanvas } from '../lib/kit.js';

const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('meltdown');
const finish = new Finish(1994);
const INK = '#07090b', LINE = '#c9d6dc', RED = '#e0182c', CREAM = '#f4e6d0';

// ---------------------------------------------------------------- world (y grows downward)
const L = { surface: 1400, data: 3300, temple: 4700, rock: 6500, magma: 7500 };
const CORE = { born: 18, y0: 3620 };
const r = rng(76);
const TOWERS = Array.from({ length: 14 }, (_, i) => ({ x: i * 82 - 30 + r() * 30, w: 58 + r() * 34, h: 260 + r() * 520 }));
const ROWS = Array.from({ length: 30 }, (_, i) => ({ y: L.surface + 40 + i * 62, n: 18 + Math.floor(r() * 14), s: r() * 1000 }));
const STRATA = Array.from({ length: 9 }, (_, i) => ({ y: L.temple + i * 200 + r() * 40, kind: i % 4, tilt: (r() - 0.5) * 0.06 }));
const FOSSILS = Array.from({ length: 22 }, () => ({ x: 80 + r() * 920, y: L.temple + 60 + r() * 1700, k: Math.floor(r() * 3), s: 30 + r() * 40, a: r() * 6 }));

// camera: world y at screen centre, by beat
function coreY(b) {
  if (b < 40) return CORE.y0;
  return CORE.y0 + Math.pow(clamp((b - 40) / 16), 1.6) * (L.magma + 700 - CORE.y0);
}
function camY(b) {
  if (b < 8) return lerp(760, 1150, ease.inOutCubic(b / 8));
  if (b < 24) return lerp(1150, CORE.y0 - 200, ease.inOutCubic((b - 8) / 16));
  if (b < 40) return CORE.y0 - 200 + (b - 24) * 12;
  return coreY(b) - 260;
}

// ---------------------------------------------------------------- drawing
function hatch(x0, y0, w, h, gap, ang, color, lw = 2) {
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
  const d = Math.hypot(w, h), c = Math.cos(ang), s = Math.sin(ang);
  for (let k = -d; k < d; k += gap) { const cx = x0 + w / 2 + k * s, cy = y0 + h / 2 - k * c; ctx.moveTo(cx - c * d, cy - s * d); ctx.lineTo(cx + c * d, cy + s * d); }
  ctx.stroke(); ctx.restore();
}
function surface(t, b, dark) {
  const g = ctx.createLinearGradient(0, 0, 0, L.surface);
  g.addColorStop(0, '#020305'); g.addColorStop(1, '#0d1418');
  ctx.fillStyle = g; ctx.fillRect(0, -400, W, L.surface + 400);
  for (const tw of TOWERS) {                                   // the finance skyline: windows are the index, lit
    const top = L.surface - tw.h;
    ctx.fillStyle = '#0a0e11'; ctx.fillRect(tw.x, top, tw.w, tw.h);
    ctx.strokeStyle = LINE; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.strokeRect(tw.x, top, tw.w, tw.h); ctx.globalAlpha = 1;
    for (let wy = top + 14; wy < L.surface - 10; wy += 22) for (let wx = tw.x + 8; wx < tw.x + tw.w - 10; wx += 16) {
      const on = Math.sin(wx * 12.9 + wy * 7.1) > 0.1 && (1 - dark) > ((wx * 7 + wy) % 97) / 97;
      if (on) { ctx.fillStyle = '#ffd9a0'; ctx.fillRect(wx, wy, 8, 10); }
    }
  }
  ctx.strokeStyle = LINE; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, L.surface); ctx.lineTo(W, L.surface); ctx.stroke();
}
function dataStrata(t, b, dark, scan) {
  ctx.fillStyle = '#081013'; ctx.fillRect(0, L.surface, W, L.data - L.surface);
  for (const row of ROWS) {                                    // each stratum: a row of indexed cells
    const cw = W / row.n;
    for (let i = 0; i < row.n; i++) {
      const lit = Math.abs(row.y - scan) < 140 ? 1 : 0.18 + 0.12 * Math.sin(t * 3 + i + row.s);
      const alive = (1 - dark) > ((i * 13 + row.s) % 100) / 100;
      ctx.fillStyle = alive ? `rgba(120,220,255,${0.12 + 0.5 * lit})` : 'rgba(60,70,80,0.15)';
      ctx.fillRect(i * cw + 3, row.y, cw - 6, 34);
    }
    ctx.strokeStyle = 'rgba(201,214,220,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, row.y + 48); ctx.lineTo(W, row.y + 48); ctx.stroke();
  }
  if (scan > L.surface && scan < L.data + 400) {             // the search: a sweeping beam descending through the index
    const g = ctx.createLinearGradient(0, scan - 120, 0, scan + 30);
    g.addColorStop(0, 'rgba(120,220,255,0)'); g.addColorStop(1, 'rgba(200,245,255,0.8)');
    ctx.fillStyle = g; ctx.fillRect(0, scan - 120, W, 150);
    ctx.fillStyle = '#e8fbff'; ctx.fillRect(0, scan + 28, W, 4);
  }
}
function temple(t, b, frost) {                               // the superstructure: a colonnade, then locked in ice
  const y0 = L.data, y1 = L.temple;
  ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, y0, W, y1 - y0);
  const top = y0 + 200, base = y1 - 160;
  ctx.fillStyle = '#20252a'; ctx.strokeStyle = LINE; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(80, top); ctx.lineTo(W / 2, top - 170); ctx.lineTo(W - 80, top); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillRect(80, top, W - 160, 60); ctx.strokeRect(80, top, W - 160, 60);
  for (let i = 0; i < 7; i++) {
    const cx = 150 + i * 130;
    ctx.fillStyle = '#1a1f24'; ctx.fillRect(cx - 34, top + 60, 68, base - top - 60); ctx.strokeRect(cx - 34, top + 60, 68, base - top - 60);
    for (let f = -2; f <= 2; f++) { ctx.beginPath(); ctx.moveTo(cx + f * 12, top + 70); ctx.lineTo(cx + f * 12, base - 10); ctx.globalAlpha = 0.4; ctx.stroke(); ctx.globalAlpha = 1; }
  }
  ctx.fillStyle = '#20252a'; ctx.fillRect(40, base, W - 80, 70); ctx.strokeRect(40, base, W - 80, 70);
  if (frost > 0) {                                             // ice: pale fill, crystal facets, cracks
    ctx.fillStyle = `rgba(170,215,240,${0.55 * frost})`; ctx.fillRect(0, y0, W, y1 - y0);
    const fr = rng(31); ctx.strokeStyle = `rgba(235,250,255,${0.8 * frost})`; ctx.lineWidth = 2;
    for (let k = 0; k < 60 * frost; k++) {
      let x = fr() * W, y = y0 + fr() * (y1 - y0); ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 5; s++) { x += (fr() - 0.5) * 160; y += (fr() - 0.5) * 160; ctx.lineTo(x, y); } ctx.stroke();
    }
  }
}
function bedrock(t, b) {
  ctx.fillStyle = '#120c09'; ctx.fillRect(0, L.temple, W, L.rock - L.temple + 200);
  STRATA.forEach((s) => {
    const y = s.y, h = 200;
    ctx.save(); ctx.translate(W / 2, y); ctx.rotate(s.tilt); ctx.translate(-W / 2, -y);
    ctx.fillStyle = ['#1c130e', '#241810', '#160f0b', '#2a1a12'][s.kind]; ctx.fillRect(-60, y, W + 120, h);
    if (s.kind === 0) hatch(-60, y, W + 120, h, 18, 0.7, 'rgba(201,180,160,0.25)');
    if (s.kind === 1) { ctx.fillStyle = 'rgba(201,180,160,0.3)'; for (let k = 0; k < 160; k++) ctx.fillRect(((k * 97) % (W + 100)) - 50, y + ((k * 53) % h), 5, 5); }
    if (s.kind === 2) { hatch(-60, y, W + 120, h, 22, -0.7, 'rgba(201,180,160,0.2)'); hatch(-60, y, W + 120, h, 22, 0.7, 'rgba(201,180,160,0.2)'); }
    if (s.kind === 3) { ctx.strokeStyle = 'rgba(201,180,160,0.3)'; ctx.lineWidth = 2; for (let k = 0; k < 7; k++) { ctx.beginPath(); for (let x = -60; x < W + 60; x += 30) ctx.lineTo(x, y + 20 + k * 26 + Math.sin(x * 0.02 + k) * 8); ctx.stroke(); } }
    ctx.strokeStyle = 'rgba(201,214,220,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-60, y); ctx.lineTo(W + 60, y); ctx.stroke();
    ctx.restore();
  });
  ctx.strokeStyle = 'rgba(230,210,190,0.55)'; ctx.lineWidth = 3;          // fossils of past orders: coins, gears, keys
  for (const f of FOSSILS) {
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a);
    if (f.k === 0) { ctx.beginPath(); ctx.arc(0, 0, f.s * 0.6, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, f.s * 0.45, 0, 7); ctx.stroke(); }
    if (f.k === 1) { ctx.beginPath(); for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, rr = k % 2 ? f.s * 0.5 : f.s * 0.66; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.stroke(); }
    if (f.k === 2) { ctx.beginPath(); ctx.arc(-f.s * 0.4, 0, f.s * 0.25, 0, 7); ctx.moveTo(-f.s * 0.15, 0); ctx.lineTo(f.s * 0.7, 0); ctx.lineTo(f.s * 0.7, f.s * 0.2); ctx.stroke(); }
    ctx.restore();
  }
}
function magma(t, b) {
  const y0 = L.rock, y1 = L.magma + 900;
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#2a0c04'); g.addColorStop(0.3, '#a8230a'); g.addColorStop(0.7, '#ff6a10'); g.addColorStop(1, '#ffd070');
  ctx.fillStyle = g; ctx.fillRect(0, y0, W, y1 - y0);
  ctx.fillStyle = 'rgba(40,6,2,0.55)';
  for (let k = 0; k < 40; k++) { const x = (k * 131 + t * 40 * (k % 3 + 1)) % (W + 200) - 100, y = y0 + 100 + ((k * 211) % (y1 - y0 - 200));
    ctx.beginPath(); ctx.ellipse(x, y, 60 + (k % 5) * 20, 18 + (k % 3) * 8, 0, 0, 7); ctx.fill(); }
}
function core(x, y, rad, t, frost, kick) {
  const heat = frost ? 1 - 0.6 * frost : 1;
  const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 4);
  g.addColorStop(0, `rgba(255,255,240,${heat})`); g.addColorStop(0.18, `rgba(255,210,120,${0.9 * heat})`);
  g.addColorStop(0.45, `rgba(255,70,30,${0.45 * heat})`); g.addColorStop(1, 'rgba(255,40,20,0)');
  ctx.fillStyle = g; ctx.fillRect(x - rad * 4, y - rad * 4, rad * 8, rad * 8);
  ctx.fillStyle = frost > 0.5 ? '#dff4ff' : '#fffef0'; ctx.beginPath(); ctx.arc(x, y, rad * (1 + 0.15 * kick), 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
  for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(x, y, rad * (1.8 + k * 0.6), rad * (0.5 + k * 0.2), t * (0.8 + k * 0.5) + k, 0, 7); ctx.stroke(); }
}
function town(t, b, u, kick) {                                // the other side: an American mill town, the core rising as its dawn
  const sunY = lerp(1500, 700, ease.outCubic(u));
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2a0a0a'); g.addColorStop(0.55, '#b0341a'); g.addColorStop(1, '#ffb060');
  ctx.fillStyle = '#12070a'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.35 + 0.65 * u; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  core(W / 2, sunY, 150 + 20 * kick, t, 0, kick);
  const rr = rng(1776), ground = 1380;                       // stacks, a water tower, rowhouses, the mill
  ctx.fillStyle = '#0c0506';
  for (let i = 0; i < 5; i++) { const x = 90 + i * 70; ctx.fillRect(x, ground - 520 + i * 30, 34, 520); }
  ctx.fillRect(40, ground - 260, 420, 260);
  ctx.beginPath(); ctx.moveTo(700, ground - 300); ctx.lineTo(820, ground - 300); ctx.lineTo(800, ground - 380); ctx.lineTo(720, ground - 380); ctx.fill();
  ctx.fillRect(740, ground - 300, 10, 300); ctx.fillRect(770, ground - 300, 10, 300);
  for (let x = 0; x < W; x += 90) { const h = 110 + rr() * 60; ctx.beginPath(); ctx.moveTo(x, ground); ctx.lineTo(x, ground - h); ctx.lineTo(x + 45, ground - h - 50); ctx.lineTo(x + 90, ground - h); ctx.lineTo(x + 90, ground); ctx.fill(); }
  ctx.fillRect(0, ground, W, H - ground);
  const on = clamp((b - 58) / 5);                              // switched on: windows light street by street
  const wr = rng(250);
  for (let k = 0; k < 140; k++) { const x = wr() * W, y = ground - 20 - wr() * 180, d = wr();
    if (d < on) { ctx.fillStyle = '#ffd890'; ctx.fillRect(x, y, 10, 12); } }
  for (let k = 0; k < 60; k++) { const x = wr() * W, y = ground + 60 + wr() * (H - ground - 200), d = wr();
    if (d < on) { ctx.fillStyle = `rgba(255,200,120,${0.6 + 0.4 * Math.sin(t * 4 + k)})`; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); } }
  ctx.strokeStyle = 'rgba(255,190,120,0.8)'; ctx.lineWidth = 2;            // power lines strung from the core to the town
  for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(W / 2, sunY); ctx.quadraticCurveTo(200 + k * 220, sunY + 300, 120 + k * 260, ground - 200); ctx.globalAlpha = on; ctx.stroke(); ctx.globalAlpha = 1; }
}
function depthRule(y) {                                        // cross-section margin: depth ticks, readout
  ctx.save(); ctx.strokeStyle = 'rgba(201,214,220,0.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(62, 0); ctx.lineTo(62, H); ctx.stroke();
  const top = y - H / 2;
  for (let d = Math.ceil(top / 100) * 100; d < top + H; d += 100) { const sy = d - top; ctx.beginPath(); ctx.moveTo(62, sy); ctx.lineTo(d % 500 ? 76 : 92, sy); ctx.stroke(); }
  line(ctx, `−${Math.max(0, Math.round((y - L.surface) * 1.7)).toLocaleString('en-US')} m`, 104, 120, { family: 'Plex Mono', size: 34, align: 'left', color: 'rgba(201,214,220,0.9)' });
  ctx.restore();
}

// ---------------------------------------------------------------- words: a stamped caption, low, with a red rule
const WORDS = [[1, 'ALL CAPITAL'], [4, 'SEARCHES.'], [7, null], [12, 'DEEPER.'], [15, null], [16, 'UNTIL'], [18, 'IT IGNITES.'], [22, null],
  [24, 'PROFIT'], [26, 'ZERO.'], [28, 'FREEZE.'], [31, null], [36, "IT WON'T"], [38, 'HOLD.'],
  [40, 'MELTDOWN.'], [43, null], [44, 'THROUGH'], [46, 'HISTORY.'], [49, null], [52, 'IT ARRIVES.'], [55, null],
  [58, 'SWITCHED ON.'], [61, null], [62, 'OURS.'], [66, '2036.']];
const at = (list, b) => { let q = list[0]; for (const x of list) if (b >= x[0]) q = x; return q; };
function words(b, tint) {
  const w = at(WORDS, b); if (!w[1] || b < w[0]) return;
  const age = (b - w[0]) * B.spb, a = ease.outExpo(clamp(age / 0.12)), big = w[1] === 'MELTDOWN.' || w[1] === '2036.';
  const y = big ? 1060 : 1620, size = big ? 260 : 170;
  ctx.fillStyle = RED; ctx.fillRect(W / 2 - 300 * a, y + 28, 600 * a, 10);
  line(ctx, w[1], W / 2, y + (1 - a) * 40, { family: 'Anton', size: size * (1 + 0.2 * Math.exp(-age * 12)), color: tint, alpha: a, stroke: 12, strokeColor: '#050607', maxW: W - 120 });
}

window.renderFrame = async (t) => {
  const b = B.beat(t), frame = Math.round(t * 30);
  if (b >= 72) { closer(ctx, (b - 72) * B.spb); finish.apply(ctx, frame, { grain: 0.06, vignette: 0.6 }); return; }
  const kick = B.env('kick', t, 9), imp = B.env('impact', t, 5);
  const frost = b >= 26 && b < 40 ? clamp((b - 26.5) / 3) : b >= 40 ? Math.max(0, 1 - (b - 40) * 2) : 0;
  const dark = clamp((b - 24) / 3);
  if (b < 56) {
    const cy = camY(b), shake = (b >= 40 ? 18 : 6) * kick;
    const zoom = 1 + 0.04 * kick + 0.1 * imp + (b >= 28 && b < 40 ? (b - 28) * 0.02 : 0);
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(W / 2 + Math.sin(t * 91) * shake, H / 2 + Math.cos(t * 77) * shake); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -cy);
    const top = cy - H / zoom, bot = cy + H / zoom;
    if (top < L.surface) surface(t, b, dark);
    const scan = b < 20 ? lerp(L.surface, L.data + 300, ease.inOutCubic(b / 20)) : -1e9;
    if (top < L.data && bot > L.surface) dataStrata(t, b, dark, scan);
    if (top < L.temple && bot > L.data) temple(t, b, frost);
    if (top < L.rock + 200 && bot > L.temple) bedrock(t, b);
    if (bot > L.rock) magma(t, b);
    if (b >= 40) {                                             // the channel the core burns through the ice and rock
      const cyc = coreY(b); ctx.fillStyle = 'rgba(255,150,60,0.5)';
      ctx.beginPath(); ctx.moveTo(W / 2 - 90, CORE.y0 - 80); ctx.lineTo(W / 2 + 90, CORE.y0 - 80); ctx.lineTo(W / 2 + 40, cyc); ctx.lineTo(W / 2 - 40, cyc); ctx.fill();
    }
    if (b >= 16) {
      const born = ease.outBack(clamp((b - CORE.born) / 1.5)), rad = b < 40 ? 70 * born : 70 + (b - 40) * 3;
      if (rad > 0) core(W / 2, coreY(b), rad, t, frost, kick);
      if (b >= 40) {                                           // melt drips trailing the fall
        ctx.fillStyle = 'rgba(255,150,60,0.8)';
        for (let k = 0; k < 14; k++) { const dx = Math.sin(k * 3.1 + t * 2) * 70, dy = -((t * 400 + k * 90) % 600); ctx.beginPath(); ctx.ellipse(W / 2 + dx, coreY(b) + dy, 8, 22, 0, 0, 7); ctx.fill(); }
      }
    }
    ctx.restore();
    depthRule(cy);
  } else {                                                     // the flip: the section turns over, the core is the dawn
    const u = clamp((b - 56) / 3);
    ctx.save();
    if (b < 57) { ctx.translate(W / 2, H / 2); ctx.rotate(Math.PI * (1 - ease.outExpo(b - 56))); ctx.translate(-W / 2, -H / 2); }
    town(t, b, u, kick);
    ctx.restore();
  }
  words(b, frost > 0.5 ? '#e8f7ff' : CREAM);
  const flash = (b >= 18 && b < 18.3 ? 0.9 - (b - 18) * 3 : 0) + (b >= 40 && b < 40.3 ? 1 - (b - 40) * 3.3 : 0) + (b >= 56 && b < 56.3 ? 0.8 - (b - 56) * 2.6 : 0);
  finish.apply(ctx, frame, { grain: 0.08, vignette: 0.7, flash });
};
window.sceneReady = true;
