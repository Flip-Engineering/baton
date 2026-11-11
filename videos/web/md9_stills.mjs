// QA stills for MELTDOWN v9 (scenes/meltdown8.js): renders beats to videos/review/meltdown9/, times every frame,
// measures steady-state sec/frame, and writes a labelled contact sheet.
//   node web/md9_stills.mjs                         -> every 2 beats over the whole piece + sheet + timing
//   node web/md9_stills.mjs 56,58.5,60              (beats)
//   node web/md9_stills.mjs --tag probe 60.5        (writes probe_*.jpg; a sheet only when there are several)
//   --hits FILE   serve this hit map in place of out/.meltdown8.hits.json (so a fresh song can be checked without
//                 touching out/); --steady B1,B2    beats to time 4 consecutive frames at
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..'), OUT = path.join(ROOT, 'review', 'meltdown9');
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const take = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const tag = take('tag') || 'md9', hitsFile = take('hits'), steadyArg = take('steady'), query = take('query') || '';
const hitsPath = hitsFile ? path.resolve(hitsFile) : path.join(ROOT, 'out', '.meltdown8.hits.json');
const HITS = JSON.parse(fs.readFileSync(hitsPath));
const spb = 60 / HITS.bpm, nBeats = Math.floor(HITS.duration / spb);
const DEF = []; for (let b = 0; b <= nBeats; b += 2) DEF.push(b + 0.25);
const beats = argv.length ? argv[0].split(',').map(Number) : DEF;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const p = url.endsWith('/out/.meltdown8.hits.json') ? hitsPath : path.join(ROOT, url);
  if (!p.startsWith(ROOT) && p !== hitsPath || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(600000);
page.on('console', m => console.log('[page]', m.text())); page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/meltdown8.html${query}`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 300000 });
console.log(`load ${((Date.now() - t0) / 1000).toFixed(1)}s (bpm ${HITS.bpm}, ${nBeats} beats)`);
const canvas = await page.$('#out');
const rows = [], files = [];
for (const b of beats) {
  const t = Math.min(b * spb, HITS.duration - 1 / 30), s0 = Date.now();
  await page.evaluate(t => window.renderFrame(t), t);
  const f = path.join(OUT, `${tag}_${b.toFixed(2).padStart(5, '0')}.jpg`);
  fs.writeFileSync(f, await canvas.screenshot({ type: 'jpeg', quality: 90, timeout: 600000 }));
  const ms = Date.now() - s0;
  rows.push({ beat: b, t: +t.toFixed(3), ms }); files.push(f); console.log(`beat ${b} (${t.toFixed(2)}s): ${ms} ms`);
}
// steady-state cost: 4 consecutive frames (render + grab), shaders warm
const steady = steadyArg ? steadyArg.split(',').map(Number) : (tag === 'md9' ? [2, 20, 38, 47, 57, 60.5, 63.5, 65] : []);
const st = [];
for (const b of steady) {
  const ts = [0, 1, 2, 3].map(k => b * spb + k / 30); let sum = 0;
  for (const t of ts) { const s0 = Date.now(); await page.evaluate(t => window.renderFrame(t), t); await canvas.screenshot({ type: 'jpeg', quality: 90, timeout: 600000 }); sum += Date.now() - s0; }
  const ms = Math.round(sum / ts.length); st.push(ms); rows.push({ steady_at_beat: b, ms_per_frame: ms }); console.log(`steady @b${b}: ${ms} ms/frame`);
}
if (st.length) { const mean = st.reduce((a, b) => a + b, 0) / st.length; rows.push({ steady_mean_ms: Math.round(mean), steady_max_ms: Math.max(...st) }); console.log(`steady mean ${(mean / 1000).toFixed(2)} s/frame, max ${(Math.max(...st) / 1000).toFixed(2)}`); }
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
