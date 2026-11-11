// Frame-edge sweep for type (TOOLING R1): renders a scene at a time step WITHOUT screenshots and reads its type audit
// (window.typeInfo(), fed by typeAudit.add()), reporting every block the frame edge crops and every band / ladder
// issue, grouped by line with the times it happens. Fast: no JPEG, no audio, no video.
//   node videos/tools/type_edges.mjs <scene> [--from-beat 16 --to-beat 24 | --from 0 --to 6] [--step 0.1] [--json out.json]
// Needs out/.<scene>.hits.json (any render or make_audio writes it) and a scene that sets window.typeInfo; a scene
// without it gets a note and exit 2. Exit 1 when any block is cropped by the frame edge.
import fs from 'node:fs'; import path from 'node:path';
import { openScene, loadavg, ROOT } from './_page.mjs';
const argv = process.argv.slice(2), scene = argv.find(a => !a.startsWith('--') && !/^-?\d/.test(a));
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if (!scene) { console.error('usage: node tools/type_edges.mjs <scene> [--from-beat B --to-beat B | --from S --to S] [--step S] [--json F]'); process.exit(2); }
const S = await openScene(scene);
const spb = 60 / (S.hits.bpm || S.hits.BPM || 120), dur = S.hits.duration || S.hits.dur || 30;
const from = opt('--from-beat') != null ? +opt('--from-beat') * spb : +opt('--from', 0);
const to = opt('--to-beat') != null ? +opt('--to-beat') * spb : +opt('--to', dur);
const step = +opt('--step', 0.1);
if (!(await S.page.evaluate(() => typeof window.typeInfo === 'function'))) {
  console.log(`${scene}: no window.typeInfo. Expose typeAudit (typeAudit.reset() per frame, typeAudit.add(block, xf) per block, window.typeInfo = () => typeAudit.items) to sweep it.`);
  await S.close(); process.exit(2);
}
const lines = new Map(), t0 = Date.now(); let frames = 0;
for (let t = from; t <= to + 1e-6; t += step) {
  const tf = Date.now(); await S.page.evaluate(tt => window.renderFrame(tt), t); frames++;
  if (argv.includes('--progress')) console.error(`  t ${t.toFixed(2)} s ${Date.now() - tf} ms`);
  let items = await S.page.evaluate(() => window.typeInfo());
  items = Array.isArray(items) ? items : (items && items.items) || [];
  for (const it of items) {
    if (!it.issues || !it.issues.length) continue;
    const key = it.text, L = lines.get(key) || { text: key, role: it.role, crop: 0, times: [], issues: new Map() };
    L.crop = Math.max(L.crop, it.crop || 0); L.times.push(+t.toFixed(3)); it.issues.forEach(i => { const k = i.replace(/-?\d+(\.\d+)?/g, '#'); if (!L.issues.has(k)) L.issues.set(k, i); });
    lines.set(key, L);
  }
}
await S.close();
const rows = [...lines.values()].sort((a, b) => b.crop - a.crop), cropped = rows.filter(r => r.crop > 1);
console.log(`${scene}: ${frames} frames ${from.toFixed(2)}-${to.toFixed(2)} s every ${step} s in ${((Date.now() - t0) / 1000).toFixed(0)} s (load ${loadavg()})`);
for (const r of rows) console.log(`  ${r.crop > 1 ? 'CROP' : 'note'} "${r.text}" (${r.role}) b${(r.times[0] / spb).toFixed(2)}-b${(r.times.at(-1) / spb).toFixed(2)} ` +
  `${r.times.length} frames${r.crop > 1 ? `, up to ${r.crop} px off frame` : ''}: ${[...r.issues.values()].join('; ')}`);
if (!rows.length) console.log('  no type issues: nothing cropped, everything in the band and on the ladder');
if (opt('--json')) fs.writeFileSync(path.resolve(opt('--json')), JSON.stringify({ scene, from, to, step, spb, lines: rows.map(r => ({ ...r, issues: [...r.issues.values()] })) }, null, 1));
process.exit(cropped.length ? 1 : 0);
