// per-frame profiler (not part of the pipeline): [PROF=1] [SCENE=lab_physics] node web/prof_physics.mjs t1,t2,... [framesPerPoint]
// PROF=1 sets window.PROF so scenes that support it flush the GPU after each timed stage (see lab_physics.js).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { handleCache } from './cache_server.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const server = http.createServer((req, res) => { if (handleCache(req, res, ROOT)) return; const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.setDefaultTimeout(600000);
page.on('console', m => { if (!m.text().startsWith('ms ')) console.log('[page]', m.text()); });
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${process.env.SCENE || 'lab_physics'}.html${process.env.QUERY || ''}`);
if (process.env.SHOTS) fs.mkdirSync(process.env.SHOTS, { recursive: true });
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 300000 });
const canvas = await page.$('#out');
if (process.env.PROF) await page.evaluate(() => { window.PROF = true; });
if (process.env.FLUSH) await page.evaluate(f => { window.FLUSH = f.split(','); }, process.env.FLUSH);
const ts = process.argv[2].split(',').map(Number), seq = Number(process.argv[3] || 1);
for (const t0 of ts) for (let k = 0; k < seq; k++) {
  const t = t0 + k / 30, a = Date.now();
  const inner = await page.evaluate(async t => { const a = performance.now(); await window.renderFrame(t); return performance.now() - a; }, t);
  const b = Date.now(); const jpg = await canvas.screenshot({ type: 'jpeg', quality: 93, timeout: 600000 }); const c = Date.now();
  if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, `t${t.toFixed(3)}.jpg`), jpg);
  const T = await page.evaluate(() => window.TIMES);
  console.log(`t=${t.toFixed(3)} ${Object.entries(T).map(([k, v]) => k + '=' + v.toFixed(0)).join(' ')} js=${inner.toFixed(0)}ms total(with GPU+grab)=${c - a}ms grab=${c - b}ms`);
}
if (process.env.STEPS) console.log(await page.evaluate(() => Object.entries(window.LAB || {}).map(([k, v]) => `${k}: step ${v.stepMs.toFixed(1)} ms` + (v.frames ? ` (${v.frames.length} frames cached)` : '')).join('\n')));
await browser.close(); server.close();
