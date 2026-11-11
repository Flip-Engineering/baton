// Bakes the ray-marched writing hands for scenes/unfinished3.js into assets/ (slow in software GL; run once).
//   node web/bake_unfinished3_hand.mjs [scale=1] [only=regex] [outdir=web/assets]
// Writes unfinished3_<sleeve>_<hand|arm>[_h].png (colour, or height: R + G/255 = cm/32, B = solid) and
// unfinished3_hand.json ({ key: { box: [x0, y0, x1, y1] cm, cmPx } }), merged with any keys already there.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [scale = '1', only = '', outDir = path.join(ROOT, 'web/assets'), box = ''] = process.argv.slice(2);
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage();
page.on('pageerror', e => { console.error(e.message); process.exit(1); });
page.on('console', m => console.log('[page]', m.text()));
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/unfinished3_bake.html?scale=${scale}&only=${encodeURIComponent(only)}${box ? '&box=' + box : ''}`, { waitUntil: 'commit', timeout: 0 });
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 0, polling: 2000 });
const baked = await page.evaluate(() => window.baked);
fs.mkdirSync(outDir, { recursive: true });
const mp = path.join(outDir, 'unfinished3_hand.json');
let meta = {}; try { meta = JSON.parse(fs.readFileSync(mp)); if (meta['1776'] && meta['1776'].nib) meta = {}; } catch {}
for (const [k, v] of Object.entries(baked)) {
  fs.writeFileSync(path.join(outDir, `unfinished3_${k}.png`), Buffer.from(v.url.split(',')[1], 'base64'));
  meta[k] = { box: v.box, cmPx: v.cmPx, tilt: v.tilt };
}
fs.writeFileSync(mp, JSON.stringify(meta));
console.log('baked', Object.keys(baked).join(' '), 'in', ((Date.now() - t0) / 1000).toFixed(0), 's');
await browser.close(); server.close();
