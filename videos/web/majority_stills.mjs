// QA stills for THE MAJORITY (scenes/majority): renders chosen beats to videos/review/majority_final/, times every
// frame, and writes a labelled contact sheet. No audio synth (reads out/.majority.hits.json as it is).
//   node web/majority_stills.mjs                    -> every 2 beats + the key off-grid beats
//   node web/majority_stills.mjs 0.2,14.5,42.3      (beats)
//   node web/majority_stills.mjs --tag probe 12.5   (writes probe_*.jpg; a sheet only if > 1)
//   node web/majority_stills.mjs --q "?sc=0.4" ...   (query string for the page)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..'), OUT = path.join(ROOT, 'review', 'majority_final');
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const tag = opt('tag') || 'mj', q = opt('q') || '';
const DEF = [0.15, 1, 2.3, 4.2, 5.4, 6.2, 7.3, 8.3, 10.2, 11.3, 12.4, 13.3, 14.3, 15.2, 15.7, 16.3, 17.4, 18.3, 19.3, 20.4, 21.3, 22.4, 23.4,
  24.3, 25.5, 26.4, 27.4, 28.2, 28.7, 29.2, 29.7, 30.5, 31.5, 32.3, 33.3, 34.4, 36.2, 36.7, 37.2, 37.7, 38.5, 40.3, 41.2, 41.7, 42.3, 43.5,
  44.5, 45.3, 46.5, 47.5, 48.4, 49.2];
const beats = argv.length ? argv[0].split(',').map(Number) : DEF;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => console.log('[page]', m.text())); page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/majority.html${q}`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 300000 });
console.log(`load ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const spb = 60 / 102, rows = [], files = [];
for (const b of beats) {
  const t = b * spb, s0 = Date.now();
  await page.evaluate(t => window.renderFrame(t), t);
  const f = path.join(OUT, `${tag}_${b.toFixed(2).padStart(5, '0')}.jpg`);
  fs.writeFileSync(f, await (await page.$('#out')).screenshot({ type: 'jpeg', quality: 90 }));
  const ms = Date.now() - s0;
  rows.push({ beat: b, t: +t.toFixed(3), ms }); files.push(f); console.log(`beat ${b} (${t.toFixed(2)}s): ${ms} ms`);
}
fs.writeFileSync(path.join(OUT, `${tag}_timing.json`), JSON.stringify(rows, null, 1));
if (files.length > 1) execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
fs = sys.argv[2:]; n = len(fs); cols = 10 if n > 12 else n; rows = (n + cols - 1) // cols
tw, th = 216, 384
S = Image.new('RGB', (cols * tw, rows * (th + 22)), (20, 16, 24)); d = ImageDraw.Draw(S)
for i, f in enumerate(fs):
    im = Image.open(f).resize((tw, th)); x, y = (i % cols) * tw, (i // cols) * (th + 22)
    S.paste(im, (x, y + 22)); d.text((x + 6, y + 5), 'beat ' + f.split('_')[-1][:-4].lstrip('0'), fill=(255, 220, 180))
S.save(sys.argv[1], quality=88)`, path.join(OUT, `${tag}_sheet.jpg`), ...files]);
await browser.close(); server.close();
