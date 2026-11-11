// Figure gate for WHO OWNS THE MACHINES: renders scenes/_machines_gate.html in each mode to videos/review/machines1/gate_<mode>.jpg
//   node web/machines_gate.mjs [trucker,hardhat,close]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..'), OUT = path.join(ROOT, 'review', 'machines1');
fs.mkdirSync(OUT, { recursive: true });
const modes = (process.argv[2] || 'trucker,hardhat,close').split(',');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
for (const m of modes) {
  const page = await browser.newPage({ viewport: { width: 3240, height: 1920 }, deviceScaleFactor: 1 });
  page.on('console', x => console.log('[page]', x.text())); page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
  await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/_machines_gate.html?mode=${m}`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 120000 });
  const t0 = Date.now(); await page.evaluate(() => window.renderFrame(0));
  fs.writeFileSync(path.join(OUT, `gate_${m}.jpg`), await (await page.$('#out')).screenshot({ type: 'jpeg', quality: 90 }));
  console.log(`${m}: ${Date.now() - t0} ms`); await page.close();
}
await browser.close(); server.close();
