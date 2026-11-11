// Bake the SIL atlas (HUMAN studio, cycle 3): node web/sil_bake.mjs  -> web/assets/sil/sil_atlas.png + sil_atlas.json
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'assets', 'sil'); fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.bvh': 'text/plain' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('console', m => console.log('[page]', m.text())); page.on('pageerror', e => console.error('[pageerror]', e.message));
const page_ = process.argv[2] || 'lab_sil_bake';
const SIDE = process.argv.includes('--side');   // HUMAN c4: the profile atlas (sil_side_atlas)
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${page_}.html${SIDE ? '?view=side' : ''}`);
await page.waitForFunction(() => window.sceneReady === true || window.sceneError, null, { timeout: 240000 });
const fn = page_ === 'lab_sil_bake' ? 'silBake' : 'fistBake', name = page_ === 'lab_sil_bake' ? (SIDE ? 'sil_side_atlas' : 'sil_atlas') : 'fist_cards';
const meta = await page.evaluate(async fn => await window[fn](), fn);
const url = await page.evaluate(() => (window.silAtlas).toDataURL('image/png'));
fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(meta));
console.log('saved', name, meta.cells.length, 'cells');
await browser.close(); server.close();
