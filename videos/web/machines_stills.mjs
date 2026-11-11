// QA stills for WHO OWNS THE MACHINES? (scenes/machines): renders beats to videos/review/machines1/, times every frame,
// writes a labelled contact sheet.
//   node web/machines_stills.mjs                       -> every 2 beats b0-b52 plus the lockup (default QA set)
//   node web/machines_stills.mjs 1,5,22.4 --tag probe  (beats; probe_*.jpg, a sheet when more than one)
//   node web/machines_stills.mjs --clip 20,24 --tag c  (every frame of a beat range -> an mp4 without sound, for motion)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..'), OUT = path.join(ROOT, 'review', 'machines1');
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const take = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const tag = take('tag') || 'qa', clip = take('clip'), query = take('query') || '';
const DEF = [...Array(27).keys()].map(i => i * 2).concat([22.6, 35.7, 50.6, 52.5, 53.3, 54.5]).sort((a, b) => a - b);
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
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/machines.html${query}`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 180000 });
console.log(`load ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const info = await page.evaluate(() => window.sceneInfo);
const spb = info.SPB, grab = async () => (await page.$('#out')).screenshot({ type: 'jpeg', quality: 92 });
if (clip) {
  const [b0, b1] = clip.split(',').map(Number), n0 = Math.round(b0 * spb * 30), n1 = Math.round(b1 * spb * 30);
  const ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  const file = path.join(OUT, `${tag}_b${b0}-${b1}.mp4`);
  const enc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-crf', '19', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const s0 = Date.now();
  for (let i = n0; i < n1; i++) { await page.evaluate(t => window.renderFrame(t), i / 30); const b = await grab(); if (!enc.stdin.write(b)) await new Promise(r => enc.stdin.once('drain', r)); }
  enc.stdin.end(); await new Promise(r => enc.on('close', r));
  console.log(`clip ${file}: ${n1 - n0} frames, ${((Date.now() - s0) / (n1 - n0)).toFixed(0)} ms/frame incl. grab`);
} else {
  const rows = [], files = [];
  for (const b of beats) {
    const t = b * spb, s0 = Date.now();
    await page.evaluate(t => window.renderFrame(t), t);
    const f = path.join(OUT, `${tag}_${b.toFixed(2).padStart(5, '0')}.jpg`);
    fs.writeFileSync(f, await grab());
    const ms = Date.now() - s0; rows.push({ beat: b, t: +t.toFixed(3), ms }); files.push(f); console.log(`beat ${b} (${t.toFixed(2)}s): ${ms} ms`);
  }
  if (tag === 'qa') for (const b of [3, 9, 13, 17, 49]) {             // steady state: consecutive frames, shaders warm
    let sum = 0; for (let k = 0; k < 4; k++) { const s0 = Date.now(); await page.evaluate(t => window.renderFrame(t), b * spb + k / 30); await grab(); sum += Date.now() - s0; }
    rows.push({ steady_at_beat: b, ms_per_frame: Math.round(sum / 4) });
  }
  fs.writeFileSync(path.join(OUT, `${tag}_timing.json`), JSON.stringify({ stand_in: info.STAND_IN, rows }, null, 1));
  if (files.length > 1) execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
fs = sys.argv[2:]; n = len(fs); cols = 11 if n > 12 else n; rows = (n + cols - 1) // cols
tw, th = 216, 384
S = Image.new('RGB', (cols * tw, rows * (th + 22)), (20, 16, 24)); d = ImageDraw.Draw(S)
for i, f in enumerate(fs):
    im = Image.open(f).resize((tw, th)); x, y = (i % cols) * tw, (i // cols) * (th + 22)
    S.paste(im, (x, y + 22)); d.text((x + 6, y + 5), 'b' + f.split('_')[-1][:-4].lstrip('0'), fill=(255, 220, 180))
S.save(sys.argv[1], quality=88)`, path.join(OUT, `${tag}_sheet.jpg`), ...files]);
}
await browser.close(); server.close();
