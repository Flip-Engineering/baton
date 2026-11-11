// Maps bench: per-effect medians (web/scenes/lab_maps_bench), look previews and the determinism check.
//   node tools/maps_bench.mjs                         all effects, median of 5, GPU-synced
//   node tools/maps_bench.mjs --only a,b              just these effects
//   node tools/maps_bench.mjs --view a,b --out DIR    render each effect once and save DIR/<name>.jpg (no timing)
//   node tools/maps_bench.mjs --perf 2,10,20,27,31,37,50,62 [--frames 6]   steady-state ms/frame as render.mjs pays it:
//       renderFrame + the JPEG canvas screenshot (so deferred GPU work is always counted), consecutive 30 fps frames
//   node tools/maps_bench.mjs --determinism [--scene lab_maps] [--beats 10,45,31,61.5]
//       renders each beat, then all of them again in reverse order, and pixel-diffs the pairs (the scene's
//       caches are warm and keyed differently the second time, so a stale-cache bug shows up as a diff).
//       Screenshots are compared byte-for-byte; a mismatch is measured and passes only as glyph anti-aliasing noise
//       (<= 1000 px, <= 8 levels: Chrome's text atlas vs path raster). Exit 1 otherwise.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; }, has = k => args.includes('--' + k);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => console.log('[page]', m.text())); page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exit(1); });
let rc = 0;
if (has('perf')) {                                   // steady-state ms/frame: N consecutive frames (30 fps) from each beat
  const scene = opt('scene', 'lab_maps'), beats = opt('perf').split(',').map(Number), N = +opt('frames', 6);
  await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${scene}.html${opt('query', '')}`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 240000 });
  const spb = 60 / JSON.parse(fs.readFileSync(path.join(ROOT, 'out', `.${scene}.hits.json`))).bpm, all = [], cv = await page.$('#out');
  for (const b of beats) {
    const ms = [];
    for (let i = 0; i < N; i++) { const a = Date.now(); await page.evaluate(t => window.renderFrame(t), b * spb + i / 30); await cv.screenshot({ type: 'jpeg', quality: 93 }); ms.push(Date.now() - a); }
    ms.sort((x, y) => x - y); all.push(...ms); console.log(`perf beat ${b}: median ${ms[N >> 1]} ms  (min ${ms[0]}, max ${ms[N - 1]}, ${N} frames)`);
  }
  all.sort((x, y) => x - y); console.log(`perf ${scene}: overall median ${all[all.length >> 1]} ms/frame, p90 ${all[Math.floor(all.length * 0.9)]} over ${all.length} frames`);
} else if (has('determinism')) {
  const scene = opt('scene', 'lab_maps'), beats = opt('beats', '10,45,31,61.5,36,20').split(',').map(Number);
  await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${scene}.html${opt('query', '')}`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 240000 });
  const bpm = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', `.${scene}.hits.json`))).bpm, spb = 60 / bpm;
  // grab through the same path render.mjs uses (a canvas screenshot): a full-frame getImageData would itself demote
  // Chrome's 2D canvas to the CPU raster path after a few reads, and the raster paths round differently
  const canvas = await page.$('#out'), grab = () => canvas.screenshot({ type: 'png' });
  const A = {};
  for (const b of beats) { await page.evaluate(t => window.renderFrame(t), b * spb); A[b] = await grab(); }
  for (const b of [...beats].reverse()) {
    await page.evaluate(t => window.renderFrame(t), b * spb); const X = await grab(), same = X.equals(A[b]);
    let verdict = 'identical';
    if (!same) {                                     // measure it: glyph-cache anti-aliasing (a few px, <= 8 levels) is tolerated
      const d = '/tmp/maps_det'; fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(`${d}/${b}_a.png`, A[b]); fs.writeFileSync(`${d}/${b}_b.png`, X);
      const [n, mx] = execFileSync('python3', ['-c', `import numpy as np; from PIL import Image
a=np.asarray(Image.open('${d}/${b}_a.png').convert('RGB')).astype(int); c=np.asarray(Image.open('${d}/${b}_b.png').convert('RGB')).astype(int)
m=np.abs(a-c).max(axis=2); print(int((m>0).sum()), int(m.max()))`]).toString().trim().split(' ').map(Number);
      const ok = mx <= 8 && n <= 1000; verdict = `${ok ? 'within AA tolerance' : 'DIFF'}: ${n} px, max ${mx} levels (pngs in ${d})`; if (!ok) rc = 1;
    }
    console.log(`determinism ${scene} beat ${b}: ${verdict}`);
  }
  console.log(`determinism ${scene}: ${rc ? 'FAIL' : 'PASS'} (${beats.length} beats rendered twice, reverse order)`);
} else {
  await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/lab_maps_bench.html`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 240000 });
  if (has('det')) { for (const pr of opt('det').split(',')) { const [a, b] = pr.split(':'); console.log(await page.evaluate(([a, b]) => window.det(a, b), [a, b])); } }
  else if (has('view')) {
    const dir = opt('out', '/tmp'); fs.mkdirSync(dir, { recursive: true });
    const canvas = await page.$('#out');
    for (const n of opt('view').split(',')) { await page.evaluate(n => window.view(n), n); fs.writeFileSync(path.join(dir, `${n}.jpg`), await canvas.screenshot({ type: 'jpeg', quality: 90 })); console.log('view', n); }
  } else {
    const names = opt('only') ? opt('only').split(',') : await page.evaluate(() => window.tests); const row = [];
    for (const n of names) row.push(`  ${n}=${(await page.evaluate(n => window.bench(n), n)).toFixed(0)}`);
    console.log(row.join('\n'));
  }
}
console.log('load', fs.readFileSync('/proc/loadavg', 'utf8').trim());
await browser.close(); server.close(); process.exit(rc || process.exitCode || 0);
