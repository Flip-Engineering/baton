// ART kit shooter: loads a lab page in headless Chromium and saves stills or a clip. Unlike render.mjs it does not
// synthesize the page's own song (labs have none): a clip is muxed with an existing wav (e.g. out/.frontier3.wav).
//
//   node web/lib/fx/art/shoot.mjs lab_art '?shot=pour' --times 0,0.5,1 --out review/studio_art_c1/after/raw --tag pour
//   node web/lib/fx/art/shoot.mjs lab_art '?shot=reel' --clip 4.5,16.5 --audio out/.frontier3.wav --out ... --tag reel
//   --png (lossless stills)  --scale 0.5 (viewport scale for quick looks; the page still renders 1080x1920)
// Writes <tag>_<t>.jpg per still and <tag>.cost.json (ms per frame as the page reports it plus wall time).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleCache } from '../../../cache_server.mjs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');       // videos/
const a = process.argv.slice(2), page0 = a[0], query = a[1] && !a[1].startsWith('--') ? a[1] : '';
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const W = 1080, H = 1920, FPS = +opt('fps', 30);   // --fps (c2): clips at 24 for heavy 3D
const has = k => a.includes('--' + k);
const outDir = path.resolve(ROOT, opt('out', 'review/studio_art_c1/after/raw')), tag = opt('tag', path.basename(page0));   // c2: the page may be a path ('../labs/lighting/lab_lighting'): name files by its base name
fs.mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wav': 'audio/wav', '.bvh': 'text/plain', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  if (handleCache(req, res, ROOT)) return;
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/web/scenes/${page0}.html${query}`);
await page.waitForFunction(() => window.sceneReady === true || window.sceneError, null, { timeout: 900000 });
const err = await page.evaluate(() => window.sceneError || null);
if (err) { console.error('scene error:', err); await browser.close(); server.close(); process.exit(2); }
const setup = Date.now() - t0;
const canvas = await page.$('#out');
const grab = (png) => canvas.screenshot({ type: png ? 'png' : 'jpeg', quality: png ? undefined : 93, timeout: 900000 });
const cost = { page: page0, query, setup_ms: setup, frames: [] };
const frame = async t => { const w0 = Date.now(); const info = await page.evaluate(tt => window.renderFrame(tt), t); return { t, wall_ms: Date.now() - w0, info }; };

if (opt('clip')) {
  const [c0, c1] = opt('clip').split(',').map(Number), n = Math.round((c1 - c0) * FPS);
  const ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  const audio = opt('audio'), mp4 = path.join(outDir, `${tag}.mp4`);
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
  if (audio) args.push('-ss', String(+opt('audioStart', c0)), '-t', String(c1 - c0), '-i', path.resolve(ROOT, audio));
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-threads', '2');
  if (audio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push(mp4);
  const enc = spawn(ff, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const every = +opt('keep', 0);            // also keep every Nth frame as a jpg for strips
  for (let i = 0; i < n; i++) {
    const t = c0 + i / FPS, f = await frame(t), buf = await grab(false);
    cost.frames.push({ t: +t.toFixed(4), wall_ms: f.wall_ms, ms: f.info?.ms, info: f.info?.info });
    if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
    if (every && i % every === 0) fs.writeFileSync(path.join(outDir, `${tag}_f${String(i).padStart(4, '0')}.jpg`), buf);
    if (i % 15 === 0) console.log(`frame ${i}/${n} t=${t.toFixed(2)} ${f.wall_ms} ms`);
  }
  enc.stdin.end(); await new Promise(r => enc.on('close', r));
  console.log('wrote', mp4);
} else {
  const times = (opt('times', '0')).split(',').map(Number), png = has('png');
  for (const t of times) {
    const f = await frame(t), buf = await grab(png);
    const fn = path.join(outDir, `${tag}_${t.toFixed(2)}.${png ? 'png' : 'jpg'}`);
    fs.writeFileSync(fn, buf); cost.frames.push({ t, wall_ms: f.wall_ms, ms: f.info?.ms, info: f.info?.info });
    console.log('wrote', fn, f.wall_ms, 'ms');
  }
}
cost.load = fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number);
fs.writeFileSync(path.join(outDir, `${tag}.cost.json`), JSON.stringify(cost, null, 1));
await browser.close(); server.close();
