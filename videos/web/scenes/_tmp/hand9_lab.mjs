// node web/scenes/_tmp/hand9_lab.mjs <out.jpg> '<json array of views>' [cols]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const [out, js, cols] = process.argv.slice(2);
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } }); page.setDefaultTimeout(900000);
page.on('console', m => console.log('[page]', m.text())); page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/_tmp/hand9_lab.html`);
await page.waitForFunction(() => window.labReady === true, null, { timeout: 900000 });
const views = JSON.parse(js), t0 = Date.now();
const err = await page.evaluate(([v, c]) => window.view(v, c), [views, Number(cols || 1)]);
const el = await page.$('#out'); fs.writeFileSync(out, await el.screenshot({ type: 'jpeg', quality: 90, timeout: 900000 }));
console.log(`view ${Date.now() - t0} ms, glError ${err}`);
await browser.close(); server.close();
