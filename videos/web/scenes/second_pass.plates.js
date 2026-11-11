// THE SECOND PASS: the two-strip plate deck.
//
// Strip A is a public-domain 1919 steel plate in ACP red; strip B is the scene's steel-blue/cream
// procedural second pass (drawn by second_pass.fab.js). Both strips share one composition and one camera.
// The deck pre-maps each plate to two duotone ramps once, at boot; no per-frame pixel work.
//
// Plate rights: videos/web/assets/iron20/RIGHTS.md (National Photo Company Collection, LoC, no known
// restrictions) and the iron13 bar frame already used by the pipeline. Nothing is downloaded at render.
import { W, H, clamp, lerp, ease, rng } from '../lib/kit.js';

export const PLATE_PATHS = {
  pour: '../assets/iron13/bar/b_001.jpg',
  puddler: '../assets/iron20/puddler.jpg',
  dock: '../assets/iron20/dock.jpg',
  bar: '../assets/iron13/bar/b_001.jpg',
  crowd: '../assets/iron20/gary_crowd.jpg',
  gary_crowd: '../assets/iron20/gary_crowd.jpg',
  pickets: '../assets/iron20/pickets.jpg',
};

// dark -> mid -> light; the red is the ACP red, the blue is the second pass's steel register
const RAMPS = {
  red: [[8, 2, 3], [132, 22, 26], [238, 216, 194]],
  blue: [[3, 8, 15], [42, 83, 112], [204, 230, 242]],
};

const load = src => new Promise((res, rej) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => rej(new Error('second_pass: plate missing: ' + src));
  im.src = src;
});

function duo(img, ramp, { contrast = 1.22, pivot = 0.44, lift = 0.0, height = 1400 } = {}) {
  const h = Math.min(height, img.height);
  const w = Math.round(img.width * h / img.height);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const id = g.getImageData(0, 0, w, h);
  const [a, b, d] = ramp;
  for (let i = 0; i < id.data.length; i += 4) {
    let l = (id.data[i] * 0.2126 + id.data[i + 1] * 0.7152 + id.data[i + 2] * 0.0722) / 255;
    l = clamp((l - pivot) * contrast + 0.5 + lift);
    l = l * l * (3 - 2 * l);
    let r, gg, bb;
    if (l < 0.5) {
      const u = l * 2;
      r = lerp(a[0], b[0], u); gg = lerp(a[1], b[1], u); bb = lerp(a[2], b[2], u);
    } else {
      const u = (l - 0.5) * 2;
      r = lerp(b[0], d[0], u); gg = lerp(b[1], d[1], u); bb = lerp(b[2], d[2], u);
    }
    id.data[i] = r; id.data[i + 1] = gg; id.data[i + 2] = bb; id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c;
}

export async function loadPlates() {
  const names = Object.keys(PLATE_PATHS);
  const imgs = await Promise.all(names.map(n => load(PLATE_PATHS[n])));
  const out = {};
  names.forEach((n, i) => {
    const im = imgs[i];
    out[n] = {
      name: n,
      src: im,
      w: Math.min(1400, im.width * Math.min(1400, im.height) / im.height),
      h: Math.min(1400, im.height),
      red: duo(im, RAMPS.red),
      blue: duo(im, RAMPS.blue, { contrast: 1.14, pivot: 0.46, lift: 0.02 }),
    };
    out[n].w = out[n].red.width;
    out[n].h = out[n].red.height;
  });
  return out;
}

// Draw a plate in one strip. `zoom` is relative to a full-height cover fit; the focus (fx,fy) is the
// plate point held at the same place on screen. Panning is clamped so no plate edge enters the frame.
export function drawPlate(ctx, plate, {
  u = 0, zoom = 1, zoom1 = null, fx = 0.5, fy = 0.5, fx1 = null, fy1 = null,
  variant = 'red', alpha = 1, dx = 0, dy = 0, rot = 0, blend = 'source-over',
} = {}) {
  const cv = plate[variant] || plate.red;
  const z = ease.inOutCubic(clamp(u)) * ((zoom1 ?? zoom) - zoom) + zoom;
  const fxx = fx1 == null ? fx : lerp(fx, fx1, ease.inOutCubic(clamp(u)));
  const fyy = fy1 == null ? fy : lerp(fy, fy1, ease.inOutCubic(clamp(u)));
  const s = Math.max(W / plate.w, H / plate.h) * z;
  const w = plate.w * s, h = plate.h * s;
  const x = (W - w) * clamp(fxx, 0, 1) + dx;
  const y = (H - h) * clamp(fyy, 0, 1) + dy;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = blend;
  if (rot) {
    ctx.translate(W / 2 + dx, H / 2 + dy);
    ctx.rotate(rot);
    ctx.drawImage(cv, x - W / 2 - dx, y - H / 2 - dy, w, h);
  } else {
    ctx.drawImage(cv, x, y, w, h);
  }
  ctx.restore();
}

// A gate weave: strip A is a physical print, so it breathes by a pixel or two. Stateless in t.
export function weave(t, seed = 0) {
  return {
    x: (Math.sin(t * 6.9 + seed) * 1.15 + Math.sin(t * 17.3 + seed * 2) * 0.55),
    y: (Math.sin(t * 5.1 + seed * 3) * 0.9 + Math.sin(t * 13.7 + seed) * 0.45),
    rot: Math.sin(t * 3.3 + seed) * 0.0012,
  };
}

// Registration crosshairs: only while the offset is changing (the packet's rule), never a HUD.
export function registrationMarks(ctx, alpha = 1, { color = '#F4E6D0', size = 26, margin = 54 } = {}) {
  if (alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  for (const [x, y] of [[margin, margin], [W - margin, margin], [margin, H - margin], [W - margin, H - margin]]) {
    ctx.beginPath();
    ctx.moveTo(x - size, y); ctx.lineTo(x - size * 0.3, y);
    ctx.moveTo(x + size * 0.3, y); ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size); ctx.lineTo(x, y - size * 0.3);
    ctx.moveTo(x, y + size * 0.3); ctx.lineTo(x, y + size);
    ctx.stroke();
  }
  ctx.restore();
}

// A soft red halation behind a hot edge or a pour.
export function glow(ctx, x, y, r, color = 'rgba(201,31,55,0.55)', alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

// A deterministic star/ember field, reused by several shots.
export function embers(ctx, t, n = 44, { alpha = 0.5, color = '#F4E6D0', seed = 7 } = {}) {
  const r = rng(seed);
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = r() * W, y0 = r() * H, sp = 0.35 + r() * 0.7, ph = r() * 6.28;
    const y = (y0 - t * 28 * sp) % H;
    ctx.globalAlpha = alpha * (0.35 + 0.65 * r()) * (0.55 + 0.45 * Math.sin(t * 2.1 + ph));
    ctx.fillRect(x, y < 0 ? y + H : y, 1.6 + r() * 2.4, 1.6 + r() * 2.4);
  }
  ctx.restore();
}
