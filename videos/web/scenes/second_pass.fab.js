// THE SECOND PASS: the procedural second register. Steel-blue and cream linework only; no stock
// semiconductor footage exists in the pipeline (packet ASSETS.md). Every function is deterministic in
// its inputs, so a still at a beat is the same frame in a render and in review.
import { W, H, clamp, lerp, ease, rng } from '../lib/kit.js';

export const BLUE = '#6FA8C8';
export const STEEL = '#9BC0D2';
export const CREAM = '#F4E6D0';
export const RED = '#C91F37';
export const DARK = '#061018';

const TAU = Math.PI * 2;

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
function circ(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }

// One-point cleanroom corridor: panels, ceiling bars, floor reflections and a row of wafer carriers.
export function fabCorridor(ctx, { u = 0, alpha = 1, color = BLUE, accent = CREAM } = {}) {
  const vx = W * 0.5, vy = H * 0.47 - u * 26;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  // the corridor mouth
  ctx.strokeRect(W * 0.08, H * 0.12, W * 0.84, H * 0.76);
  for (let i = 1; i <= 9; i++) {
    const t = i / 9, k = Math.pow(t, 1.65);
    const x = lerp(W * 0.08, vx, k), y = lerp(H * 0.12, vy, k);
    const x2 = lerp(W * 0.92, vx, k), y2 = lerp(H * 0.88, vy, k);
    ctx.globalAlpha = alpha * (0.18 + 0.5 * (1 - t));
    line(ctx, x, y, x2, y);
    line(ctx, x, H - (H - y), x2, H - (H - y));
    // wall ribs
    ctx.globalAlpha = alpha * (0.12 + 0.35 * (1 - t));
    line(ctx, x, y, x, y2);
    line(ctx, x2, y, x2, y2);
  }
  // ceiling light bars receding to the vanishing point
  for (let i = 0; i < 7; i++) {
    const t = i / 7, k = Math.pow(t, 1.5);
    const y = lerp(H * 0.16, vy - 40, k);
    const xa = lerp(W * 0.18, vx - 40, k), xb = lerp(W * 0.82, vx + 40, k);
    ctx.globalAlpha = alpha * (0.65 - 0.5 * t);
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2, 10 * (1 - t));
    line(ctx, xa, y, xb, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
  }
  // floor: a polished centre seam and reflected bars
  ctx.globalAlpha = alpha * 0.5;
  line(ctx, W * 0.5, H * 0.88, vx, vy + 20);
  for (let i = 0; i < 5; i++) {
    const y = lerp(H * 0.78, H * 0.95, i / 4);
    ctx.globalAlpha = alpha * (0.12 + 0.1 * i);
    line(ctx, W * 0.15, y, W * 0.85, y);
  }
  // wafer carriers right, a tool bay left
  ctx.globalAlpha = alpha * 0.8;
  ctx.strokeStyle = accent;
  for (let i = 0; i < 4; i++) {
    const k = i / 4, x = lerp(W * 0.78, vx + 30, k), y = lerp(H * 0.58, vy + 80, k);
    const s = lerp(1, 0.22, k);
    ctx.globalAlpha = alpha * (0.7 - 0.15 * i);
    ctx.strokeRect(x - 55 * s, y - 80 * s, 110 * s, 160 * s);
    for (let j = 1; j < 4; j++) line(ctx, x - 55 * s, y - 80 * s + j * 40 * s, x + 55 * s, y - 80 * s + j * 40 * s);
  }
  ctx.globalAlpha = alpha * 0.65;
  ctx.strokeStyle = color;
  ctx.strokeRect(W * 0.18, H * 0.55, W * 0.14, H * 0.25);
  for (let j = 0; j < 3; j++) line(ctx, W * 0.18, H * 0.59 + j * 0.05 * H, W * 0.32, H * 0.59 + j * 0.05 * H);
  ctx.restore();
}

// Articulated arm: high at rest, end effector over the wafer at u = 1. The wafer is drawn separately so
// its own ignition can answer the score.
export function robotArm(ctx, { u = 0, cx = W * 0.5, cy = H * 0.54, scale = 1, alpha = 1, color = STEEL, accent = CREAM } = {}) {
  const e = ease.inOutCubic(clamp(u));
  const base = { x: cx - 250 * scale, y: cy + 210 * scale };
  const shoulder = { x: base.x, y: base.y - 130 * scale };
  const elbow = { x: lerp(cx - 90, cx - 10, e) * 1, y: lerp(cy - 300, cy - 120, e) };
  const wrist = { x: lerp(cx + 160, cx + 40, e), y: lerp(cy - 360, cy + 40, e) };
  const tip = { x: wrist.x, y: wrist.y + lerp(52, 92, e) * scale };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // silhouette
  const limb = (a, b, w) => {
    ctx.strokeStyle = DARK; ctx.lineWidth = w + 10; line(ctx, a.x, a.y, b.x, b.y);
    ctx.strokeStyle = color; ctx.lineWidth = w; line(ctx, a.x, a.y, b.x, b.y);
    ctx.strokeStyle = accent; ctx.lineWidth = Math.max(2, w * 0.16); line(ctx, a.x, a.y, b.x, b.y);
  };
  limb(base, shoulder, 54 * scale);
  limb(shoulder, elbow, 46 * scale);
  limb(elbow, wrist, 34 * scale);
  for (const [p, r] of [[base, 38], [shoulder, 30], [elbow, 26], [wrist, 20]]) {
    ctx.fillStyle = DARK; circ(ctx, p.x, p.y, (r + 8) * scale); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 3; circ(ctx, p.x, p.y, r * scale); ctx.stroke();
    ctx.fillStyle = color; circ(ctx, p.x, p.y, r * 0.42 * scale); ctx.fill();
  }
  // end effector and its shadow on the wafer
  ctx.fillStyle = DARK; ctx.fillRect(tip.x - 28 * scale, tip.y - 10, 56 * scale, 26);
  ctx.strokeStyle = accent; ctx.lineWidth = 3;
  ctx.strokeRect(tip.x - 28 * scale, tip.y - 10, 56 * scale, 26);
  ctx.beginPath(); ctx.moveTo(tip.x - 12 * scale, tip.y + 16); ctx.lineTo(tip.x - 22 * scale, tip.y + 62);
  ctx.moveTo(tip.x + 12 * scale, tip.y + 16); ctx.lineTo(tip.x + 22 * scale, tip.y + 62); ctx.stroke();
  ctx.globalAlpha = alpha * 0.25;
  ctx.beginPath(); ctx.ellipse(tip.x, tip.y + 170 * scale, 120 * scale, 18 * scale, 0, 0, TAU); ctx.stroke();
  // cable
  ctx.globalAlpha = alpha * 0.5;
  ctx.beginPath(); ctx.moveTo(shoulder.x, shoulder.y);
  ctx.bezierCurveTo(shoulder.x - 90, shoulder.y - 80, elbow.x - 70, elbow.y + 30, wrist.x - 20, wrist.y);
  ctx.stroke();
  ctx.restore();
}

// Wafer macro: die grid, rings, notch, and a wave of ignition; `ignite` 0..1.
export function wafer(ctx, { u = 0, cx = W * 0.5, cy = H * 0.55, r = 290, rot = 0, alpha = 1, ignite = 0, color = BLUE, accent = CREAM } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  // the disc
  const g = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#123247');
  g.addColorStop(0.55, '#081824');
  g.addColorStop(1, '#030a10');
  ctx.fillStyle = g; circ(ctx, 0, 0, r); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 4; circ(ctx, 0, 0, r); ctx.stroke();
  ctx.globalAlpha = alpha * 0.75;
  for (let k = 1; k <= 4; k++) { ctx.lineWidth = 1.4; circ(ctx, 0, 0, r * (1 - k * 0.045)); ctx.stroke(); }
  // die grid, clipped to the wafer
  ctx.save();
  circ(ctx, 0, 0, r * 0.94); ctx.clip();
  const n = 17, step = (r * 1.76) / n;
  ctx.lineWidth = 1.6;
  for (let i = -n; i <= n; i++) {
    ctx.globalAlpha = alpha * 0.28;
    line(ctx, -r, i * step, r, i * step);
    line(ctx, i * step, -r, i * step, r);
  }
  // lit dies: a radial wave from the notch
  const lit = clamp(ignite);
  if (lit > 0) {
    for (let iy = -n; iy < n; iy++) for (let ix = -n; ix < n; ix++) {
      const x = (ix + 0.5) * step, y = (iy + 0.5) * step;
      const d = Math.hypot(x, y) / r;
      const a = clamp((lit * 1.25 - d) * 3.4 - ((ix * 7 + iy * 11) % 5) * 0.03);
      if (a <= 0) continue;
      ctx.globalAlpha = alpha * a * 0.55;
      ctx.fillStyle = (ix + iy) % 7 === 0 ? accent : color;
      ctx.fillRect(x - step * 0.34, y - step * 0.34, step * 0.68, step * 0.68);
    }
  }
  ctx.restore();
  // notch and a diffraction crescent
  ctx.globalAlpha = alpha * 0.9;
  ctx.fillStyle = DARK;
  ctx.beginPath(); ctx.arc(0, -r, r * 0.055, 0, TAU); ctx.fill();
  ctx.globalAlpha = alpha * 0.6;
  ctx.strokeStyle = accent; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.82, -2.4, -0.7); ctx.stroke();
  ctx.strokeStyle = RED; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.76, -2.2, -1.0); ctx.stroke();
  ctx.restore();
}

// A lit grid over the plain: the mill, the fab and the rail on one supply.
export function powerGrid(ctx, { u = 0, x = W * 0.1, y = H * 0.58, w = W * 0.8, h = H * 0.34, alpha = 1, color = BLUE, accent = CREAM } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  const rows = 6, cols = 9;
  for (let j = 0; j <= rows; j++) {
    const yy = y + h * (j / rows) - h * 0.1 * (j / rows);
    ctx.globalAlpha = alpha * (0.25 + 0.55 * clamp(u * 1.4 - j * 0.08));
    line(ctx, x - (j / rows) * 40, yy, x + w + (j / rows) * 40, yy);
  }
  for (let i = 0; i <= cols; i++) {
    const xx = x + w * (i / cols);
    ctx.globalAlpha = alpha * (0.2 + 0.5 * clamp(u * 1.2 - Math.abs(i / cols - 0.5) * 0.3));
    line(ctx, xx, y, xx, y + h);
    for (let j = 0; j <= rows; j++) {
      const yy = y + h * (j / rows) - h * 0.1 * (j / rows);
      if (clamp(u * 1.4 - j * 0.08 - Math.abs(i / cols - 0.5) * 0.2) <= 0.1) continue;
      ctx.fillStyle = (i + j) % 5 === 0 ? accent : color;
      ctx.globalAlpha = alpha * 0.65;
      ctx.fillRect(xx - 4, yy - 4, 8, 8);
    }
  }
  // the trunk line
  ctx.globalAlpha = alpha * clamp(u * 1.6);
  ctx.strokeStyle = accent; ctx.lineWidth = 5;
  line(ctx, x, y + h * 0.35, x + w, y + h * 0.35);
  ctx.restore();
}

const _townCache = new Map();
function townHouses(seed) {
  if (!_townCache.has(seed)) {
    const r = rng(seed), houses = [];
    for (let i = 0; i < 34; i++) {
      houses.push({
        x: r() * W, w: 24 + r() * 60, h: 24 + r() * 70, dy: 175 - r() * 35,
        litR: r(), col: r(), second: r(),
      });
    }
    _townCache.set(seed, houses);
  }
  return _townCache.get(seed);
}

// The town at night: the mill and the fab on the same grid. Deterministic; `u` lights windows and stacks.
export function town(ctx, { u = 0, y = H * 0.62, alpha = 1, color = BLUE, accent = CREAM, seed = 2036 } = {}) {
  const houses = townHouses(seed);
  ctx.save();
  ctx.globalAlpha = alpha;
  // horizon
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  line(ctx, 0, y + 210, W, y + 210);
  // distant plain grid
  ctx.globalAlpha = alpha * 0.35;
  for (let i = 0; i < 12; i++) {
    const x = W * i / 12;
    line(ctx, W * 0.5 + (x - W * 0.5) * 0.25, y + 40, x, H);
  }
  for (let i = 0; i < 7; i++) line(ctx, 0, y + 215 + i * 45, W, y + 215 + i * 45);
  ctx.globalAlpha = alpha;
  // houses: low silhouettes with windows
  for (const h of houses) {
    const { x, w, h: hh } = h;
    const yy = y + h.dy;
    ctx.fillStyle = 'rgba(4,12,18,0.9)';
    ctx.fillRect(x, yy - hh, w, hh);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.strokeRect(x, yy - hh, w, hh);
    const lit = clamp(u * 1.5 - h.litR * 0.8);
    if (lit > 0) {
      ctx.globalAlpha = alpha * lit;
      ctx.fillStyle = h.col < 0.7 ? accent : RED;
      ctx.fillRect(x + w * 0.2, yy - hh * 0.65, w * 0.2, hh * 0.18);
      if (h.second < 0.6) ctx.fillRect(x + w * 0.58, yy - hh * 0.65, w * 0.2, hh * 0.18);
      ctx.globalAlpha = alpha;
    }
  }
  // the mill: four stacks, a blast furnace and an ore bridge
  const mx = W * 0.1, my = y + 120;
  ctx.strokeStyle = accent; ctx.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    const x = mx + i * 78, h = 300 + (i % 2) * 60;
    ctx.strokeRect(x - 16, my - h, 32, h);
    ctx.globalAlpha = alpha * clamp(u * 1.4 - i * 0.1);
    ctx.fillStyle = RED;
    ctx.fillRect(x - 22, my - h - 10, 44, 14);
    ctx.globalAlpha = alpha;
  }
  // blast furnace body
  ctx.beginPath(); ctx.moveTo(mx + 340, my); ctx.lineTo(mx + 360, my - 240);
  ctx.lineTo(mx + 400, my - 300); ctx.lineTo(mx + 440, my - 240); ctx.lineTo(mx + 460, my); ctx.stroke();
  // fab: long sawtooth hall with a lit cleanroom band
  const fx = W * 0.52, fw = W * 0.42, fy = y + 110;
  ctx.strokeStyle = color; ctx.lineWidth = 4;
  ctx.strokeRect(fx, fy - 100, fw, 100);
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const x = fx + fw * i / 8;
    ctx.lineTo(x, fy - 100 - (i % 2 ? 0 : 26));
    ctx.lineTo(x + fw / 8, fy - 100);
  }
  ctx.stroke();
  ctx.globalAlpha = alpha * clamp(u * 1.3);
  ctx.fillStyle = accent;
  ctx.fillRect(fx + 10, fy - 54, fw - 20, 8);
  ctx.globalAlpha = alpha;
  // rail line and a train of lights
  ctx.strokeStyle = accent; ctx.lineWidth = 5;
  line(ctx, W * 0.04, y + 238, W * 0.96, y + 238);
  for (let i = 0; i < 9; i++) {
    const lit = clamp(u * 2 - i * 0.12);
    if (lit <= 0) continue;
    ctx.globalAlpha = alpha * lit;
    ctx.fillStyle = i % 3 === 0 ? RED : accent;
    ctx.fillRect(W * 0.08 + i * W * 0.1, y + 228, 10, 10);
  }
  ctx.restore();
}

// A control wheel and the hand on it. The wheel answers `u`; the hand stays, as the operator does.
export function controlWheel(ctx, { u = 0, cx = W * 0.5, cy = H * 0.56, r = 290, alpha = 1, color = STEEL, accent = CREAM } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.rotate(-0.38 + Math.sin(u * Math.PI * 2) * 0.16);
  ctx.strokeStyle = color;
  ctx.lineWidth = 22;
  circ(ctx, 0, 0, r); ctx.stroke();
  ctx.strokeStyle = accent; ctx.lineWidth = 3;
  circ(ctx, 0, 0, r + 14); ctx.stroke();
  circ(ctx, 0, 0, r - 14); ctx.stroke();
  ctx.lineWidth = 18;
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3 + Math.PI / 2;
    line(ctx, 0, 0, Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.fillStyle = DARK; circ(ctx, 0, 0, 52); ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 4; circ(ctx, 0, 0, 52); ctx.stroke();
  ctx.restore();

  // the hand (a worker's, gripping the rim at the right)
  ctx.save();
  ctx.globalAlpha = alpha * 0.96;
  ctx.translate(cx + r * 0.86, cy + r * 0.34);
  ctx.rotate(0.25);
  ctx.fillStyle = '#091722';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-36, 88);
  ctx.bezierCurveTo(-72, 44, -78, -34, -34, -62);
  ctx.bezierCurveTo(-8, -80, 42, -78, 58, -48);
  ctx.bezierCurveTo(82, -8, 70, 42, 30, 62);
  ctx.bezierCurveTo(6, 74, -18, 84, -36, 88);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // fingers over the rim
  ctx.fillStyle = 'rgba(6,16,24,0.9)';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(-10 + i * 21, -46 - (i % 2) * 6, 12, 30, -0.35, 0, TAU);
    ctx.fill(); ctx.stroke();
  }
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-8, 8); ctx.bezierCurveTo(12, 2, 28, -4, 38, -22); ctx.stroke();
  ctx.restore();
}

// The parasite's interruption: a rent meter that flatlines. No label; the picture says it.
export function rentMeter(ctx, { u = 0, flat = 0, x = W * 0.76, y = H * 0.2, w = 150, h = 470, alpha = 1, color = BLUE, accent = CREAM } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.strokeRect(x - w / 2, y, w, h);
  ctx.globalAlpha = alpha * 0.5;
  for (let i = 0; i <= 10; i++) {
    const yy = y + h * i / 10;
    line(ctx, x - w / 2, yy, x - w / 2 + (i % 5 === 0 ? 28 : 16), yy);
  }
  // the needle: normal service swings, the freeze drops it and draws a flat line
  const swing = flat ? 1.0 : 0.14 + 0.26 * Math.sin(u * Math.PI * 3) ** 2;
  const a = -Math.PI * 0.5 + swing * Math.PI;
  const nx = x + Math.cos(a) * w * 0.38, ny = y + h * 0.5 + Math.sin(a) * h * 0.38;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = flat ? RED : accent; ctx.lineWidth = 5;
  line(ctx, x, y + h * 0.5, nx, ny);
  ctx.fillStyle = RED; circ(ctx, x, y + h * 0.5, 9); ctx.fill();
  if (flat) {
    ctx.globalAlpha = alpha * 0.9;
    ctx.strokeStyle = RED; ctx.lineWidth = 4;
    line(ctx, x - w * 0.6, y + h * 0.86, x + w * 0.6, y + h * 0.86);
    // a flat trace, with one tick where the line stopped
    ctx.globalAlpha = alpha * 0.55;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const xx = x - w * 0.6 + (w * 1.2) * i / 24;
      const yy = y + h + 64 + (i === 0 ? -22 : 0);
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// The mark's raw material: two vertical strips, red and blue, snapping into register.
export function stripEdge(ctx, { x = W / 2, width = 18, y0 = 0, y1 = H, alpha = 1, color = CREAM } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x - width / 2, y0, width, y1 - y0);
  ctx.globalAlpha = alpha * 0.35;
  ctx.fillRect(x - width * 1.6, y0, width * 0.5, y1 - y0);
  ctx.fillRect(x + width * 1.1, y0, width * 0.5, y1 - y0);
  ctx.restore();
}
