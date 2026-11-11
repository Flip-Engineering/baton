// Per-frame cost of a scene at given beats: node tools/particles_time.mjs <scene> <bpm> <beat,beat,...> [frames=6]
// For each beat: one warm-up/replay frame, then `frames` sequential frames; prints median renderFrame ms and screenshot ms.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { handleCache } from '../web/cache_server.mjs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = '/home/user/acp-agitprop/videos';
const [scene, bpm, beats, nf = '6', query = ''] = process.argv.slice(2);   // query '?prof=1' prints the scene's PERF.parts (GPU-synced)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  if (handleCache(req, res, ROOT)) return; const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
const tl = Date.now();
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${scene}.html${query}`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 300000 });
console.log(`load ${((Date.now() - tl) / 1000).toFixed(1)} s`);
const canvas = await page.$('#out'); const med = a => a.sort((x, y) => x - y)[a.length >> 1];
for (const b of beats.split(',').map(Number)) {
  const t0 = b * 60 / bpm; let s = Date.now();
  await page.evaluate(t => window.renderFrame(t), t0); await canvas.screenshot({ type: 'jpeg', quality: 93 });
  const first = Date.now() - s; const rf = [], sh = [], tot = []; const parts = {};
  for (let i = 1; i <= Number(nf); i++) {
    const a = Date.now(); await page.evaluate(t => window.renderFrame(t), t0 + i / 30); const m = Date.now();
    await canvas.screenshot({ type: 'jpeg', quality: 93 }); const e = Date.now();
    rf.push(m - a); sh.push(e - m); tot.push(e - a);
    const pp = await page.evaluate(() => window.PERF && window.PERF.parts); if (pp) for (const k in pp) (parts[k] = parts[k] || []).push(pp[k]);
  }
  console.log(`beat ${String(b).padStart(5)}: jump ${first} ms | frame ${med(tot)} ms (render ${med(rf)} + grab ${med(sh)})` +
    (Object.keys(parts).length ? '  ' + Object.entries(parts).map(([k, v]) => `${k} ${med(v).toFixed(0)}`).join(' · ') : ''));
}
console.log('loadavg', fs.readFileSync('/proc/loadavg', 'utf8').trim());
await browser.close(); server.close();
