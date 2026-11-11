// QA stills for REJUVENATION (scenes/rejuvenation2): renders chosen beats to videos/review/rejuvenation3/, times every
// frame (wall and CPU-seconds of the browser tree; SwiftShader renders on the CPU) and writes a labelled contact sheet.
//   node web/rejuv_stills.mjs                         -> every 2 beats 0.5..62.5, + the closer, + sheet
//   node web/rejuv_stills.mjs 6.5,7.2,48.5            (beats)
//   node web/rejuv_stills.mjs --tag probe 12.5        (writes probe_*.jpg)
//   node web/rejuv_stills.mjs --steady 8.5,56.5       (also time 6 consecutive frames at each of these beats)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleCache } from './cache_server.mjs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const tag = flag('tag', 'qa'), steady = flag('steady', ''), query = flag('query', ''), sceneName = flag('scene', 'rejuvenation2');
const OUT = path.join(ROOT, 'review', flag('out', 'rejuvenation3'));
fs.mkdirSync(OUT, { recursive: true });
const DEF = []; for (let b = 0.5; b < 64; b += 2) DEF.push(b); DEF.push(65);
const beats = argv.length ? argv[0].split(',').map(Number) : DEF;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.otf': 'font/otf' };
const server = http.createServer((req, res) => {
  if (handleCache(req, res, ROOT)) return;
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
function cpuTree() {
  const kids = new Map();
  for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue;
    try { const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'), r = st.slice(st.lastIndexOf(')') + 2).split(' ');
      const pp = +r[1], ticks = +r[11] + +r[12]; if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push([+d, ticks]); } catch (e) {} }
  let sum = 0; const stack = [process.pid];
  while (stack.length) { const p = stack.pop(); for (const [k, t] of kids.get(p) || []) { sum += t; stack.push(k); } }
  return sum / 100;
}
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${sceneName}.html${query}`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 600000 });
console.log(`load ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const spb = 60 / 150, rows = [], files = [];
const grab = async () => (await page.$('#out')).screenshot({ type: 'jpeg', quality: 90, timeout: 600000 });
for (const b of beats) {
  const t = b * spb, s0 = Date.now(), c0 = cpuTree();
  await page.evaluate(t => window.renderFrame(t), t);
  const f = path.join(OUT, `${tag}_${b.toFixed(2).padStart(6, '0')}.jpg`);
  fs.writeFileSync(f, await grab());
  const ms = Date.now() - s0, cpu = cpuTree() - c0;
  rows.push({ beat: b, t: +t.toFixed(3), ms, cpu: +cpu.toFixed(2) }); files.push(f); console.log(`beat ${b} (${t.toFixed(2)}s): ${ms} ms, ${cpu.toFixed(2)} CPU-s`);
}
for (const b of steady ? steady.split(',').map(Number) : []) {
  await page.evaluate(t => window.renderFrame(t), b * spb - 1 / 30); await grab();
  const ts = [0, 1, 2, 3, 4, 5].map(k => b * spb + k / 30); let sum = 0; const c0 = cpuTree();
  for (const t of ts) { const s0 = Date.now(); await page.evaluate(t => window.renderFrame(t), t); await grab(); sum += Date.now() - s0; }
  const cpu = (cpuTree() - c0) / ts.length;
  rows.push({ steady_at_beat: b, ms_per_frame: Math.round(sum / ts.length), cpu_s_per_frame: +cpu.toFixed(2) }); console.log(`steady @${b}: ${Math.round(sum / ts.length)} ms/frame wall, ${cpu.toFixed(2)} CPU-s/frame`);
}
fs.writeFileSync(path.join(OUT, `${tag}_timing.json`), JSON.stringify(rows, null, 1));
if (files.length > 1) execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
fs = sys.argv[2:]; n = len(fs); cols = 8 if n > 12 else n; rows = (n + cols - 1) // cols
tw, th = 270, 480
S = Image.new('RGB', (cols * tw, rows * (th + 22)), (20, 16, 24)); d = ImageDraw.Draw(S)
for i, f in enumerate(fs):
    im = Image.open(f).resize((tw, th)); x, y = (i % cols) * tw, (i // cols) * (th + 22)
    S.paste(im, (x, y + 22)); d.text((x + 6, y + 5), 'beat ' + f.split('_')[-1][:-4].lstrip('0'), fill=(255, 220, 180))
S.save(sys.argv[1], quality=88)`, path.join(OUT, `${tag}_sheet.jpg`), ...files]);
await browser.close(); server.close();
