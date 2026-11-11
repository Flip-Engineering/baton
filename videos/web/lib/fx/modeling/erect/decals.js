// ERECT decals (MODELING c4): one atlas of the marks a built thing carries, placed as quads in the giant's batches.
// Two kinds, because a plate's life has two stages: chalk ERECTION MARKS on the red lead (where the plate goes: "L3-07"),
// which the painters paint over, and STENCILS in the top coat (numbers, loads, warnings, the works number). Invented marks only.
import * as THREE from 'three';
import { rng } from './members.js';

export const CELL = { w: 256, h: 128, cols: 8, rows: 16 };
const LIST = [];   // [{ key, kind: 'chalk'|'stencil'|'hazard', text }]
let _atlas = null, _index = null;
function texts() {
  const T = [];
  const segs = ['F', 'S', 'T', 'P', 'C', 'B', 'U', 'A', 'H'];
  const R = rng(41);
  for (let i = 0; i < 40; i++) { const s = segs[(R() * segs.length) | 0], side = R() < .5 ? 'L' : 'R'; T.push({ key: 'chalk' + i, kind: 'chalk', text: `${side}${s}${1 + ((R() * 4) | 0)}-${String(1 + ((R() * 38) | 0)).padStart(2, '0')}` }); }
  for (let i = 1; i <= 24; i++) T.push({ key: 'n' + i, kind: 'stencil', text: String(i) });
  for (const t of ['No. 1', 'L-1', 'R-1', 'SWL 400 t', 'SWL 600 t', 'KEEP CLEAR', 'DANGER', 'HYD 280 BAR', 'WORKS No. 1', 'CREW', 'LIFT HERE', 'NO STEP', 'PIN 4', 'PIN 7', '▲ 52 m', 'EXIT', 'HIP L', 'HIP R', 'KNEE L', 'KNEE R'])
    T.push({ key: 'st:' + t, kind: 'stencil', text: t });
  T.push({ key: 'hazard', kind: 'hazard', text: '' }); T.push({ key: 'hazard2', kind: 'hazard', text: '' });
  return T;
}
export function decalAtlas() {
  if (_atlas) return { tex: _atlas, index: _index };
  const W = CELL.w * CELL.cols, H = CELL.h * CELL.rows, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const T = texts(); _index = {}; const R = rng(9);
  T.forEach((d, i) => {
    const cx = (i % CELL.cols) * CELL.w, cy = Math.floor(i / CELL.cols) * CELL.h; _index[d.key] = i; LIST.push(d);
    g.save(); g.beginPath(); g.rect(cx, cy, CELL.w, CELL.h); g.clip(); g.translate(cx, cy);
    if (d.kind === 'hazard') { for (let k = -4; k < 12; k++) { g.fillStyle = k % 2 ? '#1d1d1d' : '#d4aa2c'; g.beginPath(); g.moveTo(k * 32, 0); g.lineTo(k * 32 + 32, 0); g.lineTo(k * 32 + 32 - 64, CELL.h); g.lineTo(k * 32 - 64, CELL.h); g.fill(); } }
    else if (d.kind === 'chalk') {
      g.translate(CELL.w / 2, CELL.h / 2); g.rotate((R() - .5) * .12); g.font = `600 ${58 + R() * 10}px "Archivo Black", "Anton", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(236,232,220,.95)'; g.fillText(d.text, 0, 0);
      g.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(0,0,0,${.3 + R() * .7})`; g.fillRect((R() - .5) * CELL.w, (R() - .5) * CELL.h, 1 + R() * 3, 1 + R() * 2); }
      g.globalCompositeOperation = 'source-over'; g.strokeStyle = 'rgba(236,232,220,.8)'; g.lineWidth = 4; g.beginPath(); g.moveTo(-100, 40); g.lineTo(100, 44); g.stroke();
    } else {
      g.font = `800 ${d.text.length > 6 ? 62 : 96}px "Big Shoulders Stencil Display", "Anton", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(226,219,200,1)'; g.fillText(d.text, CELL.w / 2, CELL.h / 2 + 4);
      g.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 120; k++) { g.globalAlpha = .4 + R() * .6; g.beginPath(); g.ellipse(R() * CELL.w, R() * CELL.h, 1 + R() * 5, 1 + R() * 2.5, R() * 3, 0, 7); g.fill(); }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    g.restore();
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; _atlas = t; return { tex: t, index: _index };
}
// uv function for a decal quad (PlaneGeometry, non-indexed) mapped to the atlas cell `key`
export function cellUV(key) {
  const { index } = decalAtlas(), i = index[key] ?? 0, W = CELL.w * CELL.cols, H = CELL.h * CELL.rows;
  const u0 = (i % CELL.cols) * CELL.w / W, v1 = 1 - Math.floor(i / CELL.cols) * CELL.h / H, u1 = u0 + CELL.w / W, v0 = v1 - CELL.h / H;
  return g => { const uv = g.attributes.uv.array.slice(); const o = new Float32Array(uv.length); for (let k = 0; k < uv.length; k += 2) { o[k] = u0 + uv[k] * (u1 - u0); o[k + 1] = v0 + uv[k + 1] * (v1 - v0); } return new THREE.BufferAttribute(o, 2); };
}
export const CHALK_KEYS = () => texts().filter(d => d.kind === 'chalk').map(d => d.key);
