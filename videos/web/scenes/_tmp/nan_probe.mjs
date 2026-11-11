import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'), HITS = process.argv[2], beats = process.argv[3].split(',').map(Number);
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]); const p = u.endsWith('.meltdown8.hits.json') ? HITS : path.join(ROOT, u); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.json') ? 'application/json' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } }); page.setDefaultTimeout(900000);
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/meltdown8.html`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 900000 });
for (const b of beats) for (const mode of ['all', 'nohand', 'nopts']) {
  const r = await page.evaluate(([b, mode]) => { window.mdNoHand = mode === 'nohand'; window.mdNoPts = mode === 'nopts'; return window.renderFrame(b * 0.4).then(() => window.mdDebug.nanRT()); }, [b, mode]);
  console.log(b, mode, JSON.stringify(r));
}
await browser.close(); server.close();
