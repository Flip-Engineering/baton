// QA stills for COMMON WEALTH (scenes/commonwealth3): renders chosen beats to videos/review/commonwealth4/,
// times every frame, and writes a labelled contact sheet.
//   node web/cw_stills.mjs                    -> the default QA set (every 2 beats through the transition)
//   node web/cw_stills.mjs 20.5,24.2,30.6     (beats)
//   node web/cw_stills.mjs --tag probe 12.5   (writes probe_*.jpg, no sheet)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const oi = process.argv.indexOf('--out'), OUT = oi >= 0 ? path.resolve(process.argv.splice(oi, 2)[1]) : path.join(ROOT, 'review', 'commonwealth4');
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2), ti = argv.indexOf('--tag'), tag = ti >= 0 ? argv.splice(ti, 2)[1] : 'cw';
const DEF = [0, 1.5, 4.5, 6.5, 8.6, 10.6, 12.8, 14.6, 16.4, 18.6, 20.4, 21.4, 22.8, 24.3, 25.4, 26.5, 27.5, 28.4, 29.4, 30.02, 30.4, 31.5,
  32.6, 34.6, 36.4, 37.4, 39, 40.6, 42.2, 44.6, 46.5, 48.02, 48.6, 50.3, 53, 56, 58.2, 60.4, 62.5, 63.8];   // v11 timeline
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
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/commonwealth3.html`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 180000 });
console.log(`load ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const spb = 60 / 160, rows = [], files = [];
for (const b of beats) {
  const t = b * spb, s0 = Date.now();
  await page.evaluate(t => window.renderFrame(t), t);
  const f = path.join(OUT, `${tag}_${b.toFixed(2).padStart(5, '0')}.jpg`);
  fs.writeFileSync(f, await (await page.$('#out')).screenshot({ type: 'jpeg', quality: 90 }));
  const ms = Date.now() - s0;
  rows.push({ beat: b, t: +t.toFixed(3), ms }); files.push(f); console.log(`beat ${b} (${t.toFixed(2)}s): ${ms} ms`);
}
// steady-state cost: re-render a few consecutive frames inside the transition (shaders compiled by now)
if (tag === 'cw') for (const b of [22.6, 24.4, 30.4, 36.4, 61]) {
  const ts = [0, 1, 2, 3].map(k => b * spb + k / 30); let sum = 0;
  for (const t of ts) { const s0 = Date.now(); await page.evaluate(t => window.renderFrame(t), t); await (await page.$('#out')).screenshot({ type: 'jpeg', quality: 90 }); sum += Date.now() - s0; }
  rows.push({ steady_at_beat: b, ms_per_frame: Math.round(sum / ts.length) });
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
