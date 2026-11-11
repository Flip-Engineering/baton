import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = '/home/user/acp-agitprop/videos';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
for (const q of (process.argv[2] || '?cpu=1,?cpu=0').split(',')) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/lab_type_bench.html${q}`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 180000 });
  const names = await page.evaluate(() => window.tests); const row = [];
  for (const n of names) row.push(`${n}=${(await page.evaluate(([n]) => window.bench(n), [n])).toFixed(0)}`);
  const canvas = await page.$('#out'); let s = Date.now(); for (let i = 0; i < 5; i++) await canvas.screenshot({ type: 'jpeg', quality: 93 });
  row.push(`screenshot=${((Date.now() - s) / 5).toFixed(0)}`);
  console.log(q, row.join(' ')); await page.close();
}
console.log('load', fs.readFileSync('/proc/loadavg', 'utf8').trim());
await browser.close(); server.close();
