// Per-step profile of chosen beats: node tools/type_prof.mjs <scene> <beat,beat> [--n 3] [--q '&blur=0']
// Needs the scene's ?prof=1 hook (window.__prof). Prints the median ms of each named step.
import { openScene } from './_page.mjs';
const args = process.argv.slice(2), scene = args[0], beats = args[1].split(',').map(Number);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const n = Number(opt('n', 3)), q = '?prof=1' + opt('q', '');
const S = await openScene(scene, q); const spb = 60 / S.hits.bpm;
for (const b of beats) {
  await S.page.evaluate(t => { window.renderFrame(t); window.__prof(); }, b * spb - 1 / 30);
  const runs = [];
  for (let k = 0; k < n; k++) runs.push(await S.page.evaluate(async t => { const s = performance.now(); await window.renderFrame(t); const all = performance.now() - s; return { ...window.__prof(), all }; }, b * spb + k / 30));
  const keys = Object.keys(runs[0]); const med = k => { const a = runs.map(r => r[k] || 0).sort((x, y) => x - y); return a[a.length >> 1].toFixed(0); };
  console.log(`beat ${b}: ` + keys.map(k => `${k} ${med(k)}`).join('  '));
}
await S.close();
