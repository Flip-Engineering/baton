// Type reel (TYPE studio): renders every cell of a world-type lab scene (window.CELLS) for a person to look at.
//   node tools/type_reel.mjs [scene=lab_type2] [outdir=review/studio_type_c1/after/reel] [--cells 0,1,2]
// Per cell: the hero still (<outdir>/cKK_<world>_<line>.jpg), and at every check time (0.15 s after the hit that must
// land the line) the type audit's placement facts (window.typeInfo(): a block under the platform UI band or cropped by
// the frame edge). How the type reads is judged on the stills. Render ms is wall time of renderFrame + the canvas JPEG,
// with the load average.
// Writes <outdir>/reel.json. The scene's hits.json must exist (python3 web/audio/make_audio.py <scene>).
import fs from 'node:fs'; import path from 'node:path';
import { openScene, loadavg, ROOT } from './_page.mjs';
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const scene = args[0] || 'lab_type2', out = path.resolve(ROOT, args[1] || 'review/studio_type_c1/after/reel');
const ci = process.argv.indexOf('--cells'), only = ci > 0 ? process.argv[ci + 1].split(',').map(Number) : null;
fs.mkdirSync(out, { recursive: true });
const S = await openScene(scene);
console.log(`${scene} ready in ${(S.loadMs / 1000).toFixed(1)} s (load ${loadavg()})`);
const cells = await S.page.evaluate(() => window.CELLS);
const canvas = await S.page.$('#out');
const res = [];
for (const c of cells) {
  if (only && !only.includes(c.k)) continue;
  const row = { k: c.k, world: c.world, line: c.line, hits: { A: c.A, B: c.B, chant: c.chant }, checks: [] };
  for (const t of c.check) {
    const t0 = Date.now(); await S.page.evaluate(tt => window.renderFrame(tt), t); const ms = Date.now() - t0;
    const info = await S.page.evaluate(() => window.typeInfo());
    row.checks.push({ t: +t.toFixed(3), ms, read: info.read, items: info.items });
  }
  const t0 = Date.now(); await S.page.evaluate(tt => window.renderFrame(tt), c.hero);
  const jpg = await canvas.screenshot({ type: 'jpeg', quality: 92, timeout: 600000 }); row.heroMs = Date.now() - t0;
  row.hero = { t: +c.hero.toFixed(3), file: `c${String(c.k).padStart(2, '0')}_${c.world}_${c.line}.jpg`, info: await S.page.evaluate(() => window.typeInfo()) };
  fs.writeFileSync(path.join(out, row.hero.file), jpg);
  const issues = [...new Set(row.checks.flatMap(x => x.items.flatMap(i => i.issues)))];
  console.log(`c${c.k} ${c.world.padEnd(11)} ${c.line.padEnd(6)} ${row.hero.file}  ms ${row.checks.map(x => x.ms).join('/')}+${row.heroMs}  ${issues.length ? 'placement: ' + issues.join('; ') : ''}`);
  res.push(row);
}
fs.writeFileSync(path.join(out, 'reel.json'), JSON.stringify({ scene, load: loadavg(), when: new Date().toISOString(), cells: res }, null, 1));
await S.close();
