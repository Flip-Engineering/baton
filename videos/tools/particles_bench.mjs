// node tools/particles_bench.mjs [test,test,...] [--show a+b+c,out.jpg]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = '/home/user/acp-agitprop/videos';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/lab_particles_bench.html`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 180000 });
const args = process.argv.slice(2); const si = args.indexOf('--show');
if (si >= 0) { const [list, out] = args[si + 1].split(','); await page.evaluate(l => window.show(l), list.split('+'));
  fs.writeFileSync(out, await (await page.$('#out')).screenshot({ type: 'jpeg', quality: 90 })); console.log('wrote', out); args.splice(si, 2); }
const names = args[0] ? args[0].split(',') : await page.evaluate(() => window.tests);
for (const n of names) console.log(n.padEnd(20), (await page.evaluate(n => window.bench(n), n)).toFixed(1), 'ms');
console.log('load', fs.readFileSync('/proc/loadavg', 'utf8').trim());
await browser.close(); server.close();
