// SIL: the silhouette library (HUMAN studio, cycle 3). 36 designed worker types x 20 poses, baked from people.js
// bodies in designed headwear (web/scenes/lab_sil_bake.js -> web/assets/sil/sil_atlas.png + .json).
//   atlas R rim (the form turning to a backlight), G key (N.L from the upper left), B accent (head, hat, raised fist),
//   A coverage. Cells 144 x 320 px, 130 px per metre, the foot line at y = 304.
//
//   import { loadSil } from '../lib/fx/sil.js';
//   const sil = await loadSil();                       // { meta, bitmap, cell(type, pose), types, poses, pick(r, o) }
//   sil.cell(3, 'pumpHi') -> { x, y, foot, head: [x, y, r], fist, pole, top, ... } (atlas px)
// lib/fx/ranks.js draws crowds from it (GPU, one instanced draw per rank). A 2D piece can also blit a cell with
// sil.blit(g, cell, footX, footY, heightPx, { flip, color }) (alpha only, flat colour: the cheap path).
const BASE = new URL('../../assets/sil/', import.meta.url).href;

// which poses read from BEHIND (ROTFRONT's fist at the temple reads as a hand scratching the head from the back)
export const BACK_FIST = ['pumpHi', 'overhead', 'pumpLo'];
export const STANDS = ['standA', 'standB', 'standC'];
export const WALK = Array.from({ length: 8 }, (_, k) => 'walk' + k);

// HUMAN c4: loadSil(base, 'sil_side_atlas') loads the PROFILE atlas (walk16, fist0-3, cock0-1, over0-1, pole0-3,
// lunge0-1; faces +x) with the same API. Each atlas is cached by name; loadSil() is unchanged.
const CACHES = {};
const PATHS = new Map();
// marching squares at half coverage over one atlas cell -> closed loops (sub-pixel), smoothed and drawn as quadratic
// curves through the midpoints: the outline the bake already resolved, without the bitmap's pixels
function tracePath(bitmap, c, CW, CH) {
  const cv = tracePath.cv || (tracePath.cv = document.createElement('canvas')); cv.width = CW; cv.height = CH;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.clearRect(0, 0, CW, CH); g.drawImage(bitmap, c.x, c.y, CW, CH, 0, 0, CW, CH);
  const d = g.getImageData(0, 0, CW, CH).data, w = CW + 2, h = CH + 2, A = new Float32Array(w * h);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) A[(y + 1) * w + x + 1] = d[(y * CW + x) * 4 + 3] / 255;
  const iso = 0.5, segs = [], v = (x, y) => A[y * w + x];
  // edge ids: horizontal edge from (x,y) to (x+1,y) = 2*(y*w+x), vertical (x,y)-(x,y+1) = 2*(y*w+x)+1; points in padded px
  const pt = new Map(), P = (id, x0, y0, x1, y1, a0, a1) => { if (!pt.has(id)) { const f = (iso - a0) / ((a1 - a0) || 1e-6); pt.set(id, [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]); } return id; };
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const tl = v(x, y), tr = v(x + 1, y), br = v(x + 1, y + 1), bl = v(x, y + 1);
    const ci = (tl > iso ? 8 : 0) | (tr > iso ? 4 : 0) | (br > iso ? 2 : 0) | (bl > iso ? 1 : 0);
    if (ci === 0 || ci === 15) continue;
    const T = () => P(2 * (y * w + x), x, y, x + 1, y, tl, tr), B = () => P(2 * ((y + 1) * w + x), x, y + 1, x + 1, y + 1, bl, br);
    const L = () => P(2 * (y * w + x) + 1, x, y, x, y + 1, tl, bl), R = () => P(2 * (y * w + x + 1) + 1, x + 1, y, x + 1, y + 1, tr, br);
    const mid = (tl + tr + br + bl) / 4 > iso;
    switch (ci) {
      case 1: case 14: segs.push([L(), B()]); break;   case 2: case 13: segs.push([B(), R()]); break;
      case 3: case 12: segs.push([L(), R()]); break;   case 4: case 11: segs.push([T(), R()]); break;
      case 6: case 9: segs.push([T(), B()]); break;    case 7: case 8: segs.push([L(), T()]); break;
      case 5: if (mid) { segs.push([L(), T()]); segs.push([B(), R()]); } else { segs.push([L(), B()]); segs.push([T(), R()]); } break;
      case 10: if (mid) { segs.push([T(), R()]); segs.push([L(), B()]); } else { segs.push([L(), T()]); segs.push([B(), R()]); } break;
    }
  }
  const adj = new Map(); segs.forEach((s, i) => { for (const e of s) { const l = adj.get(e); l ? l.push(i) : adj.set(e, [i]); } });
  const used = new Uint8Array(segs.length), path = new Path2D();
  for (let i0 = 0; i0 < segs.length; i0++) {
    if (used[i0]) continue; used[i0] = 1; const loop = [segs[i0][0]]; let cur = segs[i0][1];
    for (let guard = 0; guard < 100000 && cur !== loop[0]; guard++) { loop.push(cur); const nx = (adj.get(cur) || []).find(j => !used[j]); if (nx === undefined) break; used[nx] = 1; cur = segs[nx][0] === cur ? segs[nx][1] : segs[nx][0]; }
    if (loop.length < 4) continue;
    let p = loop.map(id => pt.get(id));
    for (let pass = 0; pass < 2; pass++) p = p.map((q, k) => { const a = p[(k - 1 + p.length) % p.length], b = p[(k + 1) % p.length]; return [(a[0] + 2 * q[0] + b[0]) / 4, (a[1] + 2 * q[1] + b[1]) / 4]; });
    const n = p.length, m = k => { const a = p[k % n], b = p[(k + 1) % n]; return [(a[0] + b[0]) / 2 - 1, (a[1] + b[1]) / 2 - 1]; };
    const m0 = m(0); path.moveTo(m0[0], m0[1]);
    for (let k = 1; k <= n; k++) { const q = p[k % n], e = m(k); path.quadraticCurveTo(q[0] - 1, q[1] - 1, e[0], e[1]); }
    path.closePath();
  }
  return path;
}
export const SIDE_WALK = Array.from({ length: 16 }, (_, k) => 'walk' + k);
export async function loadSil(base = BASE, name = 'sil_atlas') {
  const key = base + name; if (CACHES[key]) return CACHES[key];
  const [meta, blob] = await Promise.all([fetch(base + name + '.json').then(r => r.json()), fetch(base + name + '.png').then(r => r.blob())]);
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const idx = new Map(); for (const c of meta.cells) idx.set(c.type + ':' + c.pose, c);
  const S = {
    meta, bitmap, W: bitmap.width, H: bitmap.height, CW: meta.CW, CH: meta.CH, PPM: meta.PPM, FOOT: meta.FOOT,
    types: meta.types, poses: meta.poses,
    cell: (type, pose) => idx.get(type + ':' + pose),
    // figure height in cell px of a type (1.78 m reference -> px), for scaling to a target on-screen height
    heightPx: type => meta.types[type].h * meta.PPM,
    // a type from a weighted pick: o.fem (0..1 share), o.kinds (headwear kinds allowed), o.not (types to avoid)
    pick(r, { kinds = null, not = null } = {}) {
      for (let k = 0; k < 40; k++) { const t = Math.floor(r() * meta.types.length), ty = meta.types[t];
        if (kinds && !kinds.includes(ty.hw.split(':')[0])) continue; if (not && not.has(t)) continue; return t; }
      return Math.floor(r() * meta.types.length);
    },
    // print grade (STUDIO CIV ASSETS c1): the cell's outline traced once into a smooth vector path (marching squares on
    // the coverage, smoothed, curve-fitted), so a figure fills crisp at ANY size instead of upscaling a 144x320 bitmap.
    // path(cell) -> Path2D in cell px (fill with 'evenodd'); fill(g, cell, footX, footY, hPx, { flip }) uses g's fillStyle
    // and composite op, so it works on plate contexts and the plates router (lib/fx/plates.js) too.
    path(c) { const key = c.type + ':' + c.pose; let p = PATHS.get(key); if (!p) { p = tracePath(bitmap, c, meta.CW, meta.CH); PATHS.set(key, p); } return p; },
    fill(g, c, fx, fy, hPx, { flip = false } = {}) {
      const k = hPx / (meta.types[c.type].h * meta.PPM), x = fx - c.foot[0] * k, y = fy - c.foot[1] * k;
      g.save(); if (flip) { g.translate(fx * 2, 0); g.scale(-1, 1); } g.translate(x, y); g.scale(k, k); g.fill(S.path(c), 'evenodd'); g.restore();
    },
    // blit: flat colour. Vector (crisp) by default; { raster: true } is the old bitmap path (soft above 1x: warns)
    blit(g, c, fx, fy, hPx, { flip = false, color = '#000', raster = false } = {}) {
      if (!raster) { g.save(); g.fillStyle = color; S.fill(g, c, fx, fy, hPx, { flip }); g.restore(); return; }
      const k = hPx / (meta.types[c.type].h * meta.PPM), w = meta.CW * k, h = meta.CH * k, x = fx - c.foot[0] * k, y = fy - c.foot[1] * k;
      if (k > 1.05 && !S._warned) { S._warned = true; console.warn(`sil.blit raster upscaled ${k.toFixed(2)}x: soft; drop raster: true for the vector path`); }
      const t = S._tint || (S._tint = document.createElement('canvas')); t.width = meta.CW; t.height = meta.CH; const tg = t.getContext('2d');
      tg.clearRect(0, 0, meta.CW, meta.CH); tg.drawImage(bitmap, c.x, c.y, meta.CW, meta.CH, 0, 0, meta.CW, meta.CH);
      tg.globalCompositeOperation = 'source-in'; tg.fillStyle = color; tg.fillRect(0, 0, meta.CW, meta.CH); tg.globalCompositeOperation = 'source-over';
      g.save(); if (flip) { g.translate(fx * 2, 0); g.scale(-1, 1); } g.drawImage(t, x, y, w, h); g.restore();
    },
  };
  return (CACHES[key] = S);
}
