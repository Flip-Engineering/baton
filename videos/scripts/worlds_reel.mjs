// WORLDS studio c1 reel driver: renders lab_americana shots as stills and 2 s clips (with the piece's song under them).
//   node videos/scripts/worlds_reel.mjs still 1 [t=0] [out=review/studio_worlds_c1/after] [query=&thermal=1] [tag=]
//   node videos/scripts/worlds_reel.mjs clip m1 <song> <audioStart> [frames=60] [query=&arrive=1.8]
//   page=lab_americana2 renders the pass-2 lab (same shot names) instead of the c1 lab
// Writes <out>/<tag|shot>.jpg (+ .json with shotInfo: camera, scale checks, per-frame ms) or <out>/<shot>.mp4.
// One Chromium, SwiftShader, run it in the background; the 4-core box renders one shot at a time.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2), mode = argv[0], shot = argv[1];
const kv = Object.fromEntries(argv.filter(a => a.includes('=')).map(a => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
const OUTD = path.resolve(ROOT, kv.out || 'review/studio_worlds_c1/after'); fs.mkdirSync(OUTD, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
const q = `?shot=${shot}${kv.query || ''}`;
const T0 = Date.now();
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${kv.page || 'lab_americana'}.html${q}`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 900000, polling: 500 });
console.log(`ready in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
const canvas = await page.$('#out');
const grab = () => canvas.screenshot({ type: 'jpeg', quality: 94, timeout: 600000 });
const tag = kv.tag || `shot${shot}`;
if (mode === 'still') {
  const t = +(kv.t || 0);
  await page.evaluate(tt => window.renderFrame(tt), t);
  const t1 = Date.now(); await page.evaluate(tt => window.renderFrame(tt), t);   // second pass: timing without compile
  fs.writeFileSync(path.join(OUTD, `${tag}.jpg`), await grab()); const wall = Date.now() - t1;
  const info = await page.evaluate(() => { const I = window.shotInfo(); if (window.scaleChecks) I.scale = window.scaleChecks(); return I; }); info.wallMs = wall;
  info.planes = await page.evaluate(tt => { window.renderFrame(tt); return window.depthPlanes ? window.depthPlanes() : null; }, t);
  fs.writeFileSync(path.join(OUTD, `${tag}.json`), JSON.stringify(info, null, 1));
  console.log(tag, 'wall ms/frame (render + readback)', wall, JSON.stringify(info.scale || ''));
} else if (mode === 'clip') {
  const song = argv[2], a0 = +argv[3], n = +(kv.frames || 60), fps = 30;
  const ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  const wav = path.join(ROOT, 'out', `.${song}.wav`);
  const out = path.join(OUTD, `${tag}.mp4`);
  const aargs = fs.existsSync(wav) ? ['-ss', String(a0), '-t', String(n / fps), '-i', wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : [];
  const p = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', ...aargs,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const tc = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate(tt => window.renderFrame(tt), i / fps);
    const jpg = await grab(); p.stdin.write(jpg);
    if (kv.keep && i % 15 === 0) fs.writeFileSync(path.join(OUTD, `${tag}_f${String(i).padStart(2, '0')}.jpg`), jpg);
    if (i % 10 === 0) console.log(`frame ${i}/${n}`);
  }
  p.stdin.end(); await new Promise(r => p.on('close', r));
  const info = await page.evaluate(() => window.shotInfo());
  fs.writeFileSync(path.join(OUTD, `${tag}.json`), JSON.stringify(info, null, 1));
  info.wallMsPerFrame = Math.round((Date.now() - tc) / n); fs.writeFileSync(path.join(OUTD, `${tag}.json`), JSON.stringify(info, null, 1));
  console.log(tag, 'wall ms/frame (render + readback + encode)', info.wallMsPerFrame);
}
await browser.close(); server.close();
