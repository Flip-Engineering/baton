// beatmap.js: one authored-to-final beat map, shared with tools/beatmap.py (same JSON, same maths).
// A piece is written on a clean beat grid, then stretched where a card needs reading time. Keep the anchors in
// web/beatmaps/<piece>.json, not as a copy in the scene and another in the song.
//   import { loadBeatMap } from './lib/fx/beatmap.js';
//   const BM = await loadBeatMap('horde3');        // fetches /beatmaps/<piece>.json (or pass the parsed object to beatMap())
//   const M = BM.m;  M(64.5) -> 69.5;  BM.inv(69.5) -> 64.5;  BM.sec(b) -> seconds at the map's bpm
// Piecewise linear through the anchors; beyond the last anchor the slope is 1 (same as the scene/song copies).
export function beatMap(spec) {
  const A = spec.anchors, bpm = spec.bpm || 120;
  const m = b => { for (let i = 1; i < A.length; i++) if (b <= A[i][0]) { const [a0, m0] = A[i - 1], [a1, m1] = A[i]; return m0 + (b - a0) * (m1 - m0) / (a1 - a0); } return b + (A[A.length - 1][1] - A[A.length - 1][0]); };
  const inv = f => { for (let i = 1; i < A.length; i++) if (f <= A[i][1]) { const [a0, m0] = A[i - 1], [a1, m1] = A[i]; return a0 + (f - m0) * (a1 - a0) / (m1 - m0); } return f - (A[A.length - 1][1] - A[A.length - 1][0]); };
  return { m, inv, bpm, anchors: A, spb: 60 / bpm, sec: b => m(b) * 60 / bpm, authoredSec: b => b * 60 / bpm };
}
export async function loadBeatMap(piece, base = '/beatmaps/') {
  const r = await fetch(base + piece + '.json'); if (!r.ok) throw new Error('beatmap ' + piece + ': ' + r.status);
  return beatMap(await r.json());
}
