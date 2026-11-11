// Determinism check for particle scenes: every frame must be bit-identical however it is reached.
//   node tools/particles_determinism.mjs [scene=lab_particles] [bpm=140] [beats=3,7.5,10,12,23,30,43,66] [--seq 10]
// For each beat: A = jump there (after rendering far away), B = jump again with every Flow's in-memory checkpoints
// dropped (restores from out/.pcache or replays), C = sequential render of the last `seq` frames up to it.
// Prints mean / max |diff| (0..255) of A vs C and B vs C; exits 1 when any max diff > 0.
import { openScene, loadavg } from './_page.mjs';
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const scene = args[0] || 'lab_particles', bpm = Number(args[1] || 140);
const beats = (args[2] || '3,7.5,10,12,23,30,43,66').split(',').map(Number), seq = Number(opt('seq', 10));
const S = await openScene(scene);
console.log(`${scene}: load ${(S.loadMs / 1000).toFixed(1)} s`);
await S.page.evaluate(() => {
  const c = document.getElementById('out'), g = c.getContext('2d');
  window.__grab = () => g.getImageData(0, 0, c.width, c.height).data;
  window.__cmp = (a, b) => { let m = 0, s = 0; for (let i = 0; i < a.length; i++) { if ((i & 3) === 3) continue; const d = Math.abs(a[i] - b[i]); s += d; if (d > m) m = d; } return [s / (a.length * 0.75), m]; };
  window.__drop = () => { for (const f of globalThis.__flows || []) { f.mem.clear(); f.memBytes = 0; f.frame = -1; } };
});
let worst = 0;
for (const b of beats) {
  const t = Math.round(b * 60 / bpm * 30) / 30, far = t > 5 ? 0.5 : 20;
  const r = await S.page.evaluate(async ([t, far, seq]) => {
    const T = []; let s;
    await window.renderFrame(far); s = performance.now(); await window.renderFrame(t); T.push(performance.now() - s); const A = window.__grab();
    window.__drop(); s = performance.now(); await window.renderFrame(t); T.push(performance.now() - s); const Bm = window.__grab();
    window.__drop(); await window.renderFrame(Math.max(0, t - seq / 30));
    for (let k = seq - 1; k >= 0; k--) await window.renderFrame(Math.max(0, t - k / 30));
    const Cm = window.__grab();
    return { ac: window.__cmp(A, Cm), bc: window.__cmp(Bm, Cm), T };
  }, [t, far, seq]);
  worst = Math.max(worst, r.ac[1], r.bc[1]);
  console.log(`beat ${String(b).padStart(5)} (t ${t.toFixed(3)}): jump vs seq ${r.ac[0].toFixed(4)} / ${r.ac[1]} | cold jump vs seq ${r.bc[0].toFixed(4)} / ${r.bc[1]}` +
    `  (jump ${r.T[0].toFixed(0)} ms, cold jump ${r.T[1].toFixed(0)} ms)`);
}
console.log(`determinism ${scene}: ${worst === 0 ? 'PASS' : 'FAIL'} (max diff ${worst}/255)  loadavg ${loadavg()}`);
await S.close();
process.exit(worst === 0 ? 0 : 1);
