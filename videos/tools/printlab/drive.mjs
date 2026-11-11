// node tools/printlab/drive.mjs <srcdir> <outdir> 'job;job;...'   (renders printlab.js jobs headless on SwiftShader)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname), WEB = path.resolve(HERE, '../../web');
const [SRC, OUT, JOBS] = process.argv.slice(2);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = u.startsWith('/web/') ? path.join(WEB, u.slice(5)) : u.startsWith('/t/') ? path.join(HERE, u.slice(3)) : u.startsWith('/s/') ? path.join(SRC, u.slice(3)) : null;
  if (!p || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/t/harness.html`);
await page.evaluate(() => window.setup());
let n = 0;
for (const j of JOBS.split(';')) {
  try {
    const ms = await page.evaluate(async j => await window.run(j), j);
    const url = await page.evaluate(() => document.getElementById('out').toDataURL('image/png'));
    const f = path.join(OUT, String(n++).padStart(3, '0') + '_' + j.split('|').slice(0, 3).join('_').replace(/[^\w.-]+/g, '_') + '.png');
    fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64')); console.log('ok', j, Math.round(ms), 'ms', f);
  } catch (e) { console.log('FAIL', j, e.message.slice(0, 500)); }
}
await browser.close(); server.close();
