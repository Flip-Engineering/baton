// CLOSER c1: a short phone-size clip of a scene (window.renderFrame) with a given wav.  node web/closer_clip.mjs <scene> <from> <to> <audio.wav> <audio_offset_s> <out.mp4> [--scale 540]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn, execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { handleCache } from './cache_server.mjs'; import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const [scene, from, to, wav, aoff, out, ...rest] = process.argv.slice(2); const si = rest.indexOf('--scale'); const SC = si >= 0 ? +rest[si + 1] : 540;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => { if (handleCache(req, res, ROOT)) return; const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${scene}.html`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 600000 });
const ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
const enc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-ss', aoff, '-t', String(to - from), '-i', wav, '-map', '0:v', '-map', '1:a',
  '-vf', `scale=${SC}:-2`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const n0 = Math.round(from * 30), n1 = Math.round(to * 30), t0 = Date.now();
for (let i = n0; i < n1; i++) { await page.evaluate(t => window.renderFrame(t), i / 30); const buf = await page.locator('canvas#out').screenshot({ type: 'jpeg', quality: 85 });
  if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r)); }
enc.stdin.end(); await new Promise(r => enc.on('close', r)); console.log('wrote', out, ((Date.now() - t0) / 1000).toFixed(0) + 's'); await browser.close(); server.close();
