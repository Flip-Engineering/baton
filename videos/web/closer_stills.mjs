// CLOSER c1 stills: node web/closer_stills.mjs <scene> <t1,t2,...> <outdir> [--query ?mode=x]   (scene = scenes/<scene>.html; renders window.renderFrame(t))
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { handleCache } from './cache_server.mjs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const [scene, tl, outdir, ...rest] = process.argv.slice(2); const qi = rest.indexOf('--query'); const query = qi >= 0 ? rest[qi + 1] : '';
const times = tl.split(',').map(Number); fs.mkdirSync(outdir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => { if (handleCache(req, res, ROOT)) return; const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => { const s = m.text(); if (!/^\[vite/.test(s)) console.log('[page]', s.slice(0, 200)); }); page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${scene}.html${query}`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 600000 });
for (const t of times) { await page.evaluate(t => window.renderFrame(t), t); const f = path.join(outdir, `${scene}_${t.toFixed(3)}.jpg`);
  await page.locator('canvas#out').screenshot({ path: f, type: 'jpeg', quality: 90 }); }
console.log('wrote', times.length, 'stills to', outdir); await browser.close(); server.close();
