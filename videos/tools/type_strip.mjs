// Stills strip for a text-load before/after (TYPE studio): renders a scene at a fixed rate, no audio synth.
//   node tools/type_strip.mjs <scene> <outdir> [--query '?type=c1'] [--fps 2] [--from 0] [--to 34]
// Writes <outdir>/sNNN.jpg (t = NNN / fps) and <outdir>/strip.json (per still: t, render ms, window.typeInfo() when the
// scene has it). The scene's hits.json must exist.
import fs from 'node:fs'; import path from 'node:path';
import { openScene, loadavg, ROOT } from './_page.mjs';
const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const scene = a[0], out = path.resolve(ROOT, a[1]), fps = +opt('fps', 2), from = +opt('from', 0), to = +opt('to', 34);
fs.mkdirSync(out, { recursive: true });
const S = await openScene(scene, opt('query', ''));
console.log(`${scene}${opt('query', '')} ready in ${(S.loadMs / 1000).toFixed(1)} s (load ${loadavg()})`);
const canvas = await S.page.$('#out'), rows = [];
for (let k = Math.round(from * fps); k <= Math.round(to * fps); k++) {
  const t = k / fps, t0 = Date.now();
  await S.page.evaluate(tt => window.renderFrame(tt), t);
  const jpg = await canvas.screenshot({ type: 'jpeg', quality: 90, timeout: 600000 }), ms = Date.now() - t0;
  fs.writeFileSync(path.join(out, `s${String(k).padStart(3, '0')}.jpg`), jpg);
  const info = await S.page.evaluate(() => window.typeInfo ? window.typeInfo() : null);
  rows.push({ t, ms, info });
}
const load = await S.page.evaluate(() => window.typeLoad ? window.typeLoad() : null);
fs.writeFileSync(path.join(out, 'strip.json'), JSON.stringify({ scene, query: opt('query', ''), fps, load, loadavg: loadavg(), rows }, null, 1));
console.log(`${rows.length} stills, mean ${(rows.reduce((s, r) => s + r.ms, 0) / rows.length).toFixed(0)} ms (load ${loadavg()})`);
await S.close();
