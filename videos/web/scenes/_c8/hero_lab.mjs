// node hero_lab.mjs outprefix '[cfg,...]'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const [pre, js] = process.argv.slice(2);
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } }); page.setDefaultTimeout(900000);
page.on('console', m => console.log('[page]', m.text())); page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/_c8/hero_lab.html`);
await page.waitForFunction(() => window.labReady === true, null, { timeout: 900000 });
const cfgs = JSON.parse(js);
for (let i = 0; i < cfgs.length; i++) { const t0 = Date.now(); const kn = await page.evaluate(c => window.labDraw(c), cfgs[i]);
  const el = await page.$('#out'); fs.writeFileSync(`${pre}_${i}.jpg`, await el.screenshot({ type: 'jpeg', quality: 88 })); console.log(i, Date.now() - t0, 'ms', JSON.stringify(kn.map(k => [Math.round(k.x), Math.round(k.y)]))); }
await browser.close(); server.close();
