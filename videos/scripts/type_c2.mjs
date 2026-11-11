// TYPE c2 driver: the lab_type_c2 (2D press) and lab_type_c2_3d (light type) demos as stills and clips on SONG time.
//   node videos/scripts/type_c2.mjs still <demo> t=24.5,24.6 [page=lab_type_c2] [out=review/studio_type_c2/after] [tag=..] [query=&..]
//   node videos/scripts/type_c2.mjs clip <demo> a0=9.2 frames=60 wav=review/studio_type_c2/after/audio/.bank3.wav [strip=hit]
// A clip is rendered at the full 30 fps from song time a0 and muxed with the song's own audio from a0 (no vocals: the
// songs carry none while synthesized words are off). strip=<song s> also writes the -8..+8 frame strip around it.
// Writes <out>/<tag>.mp4 | .jpg and <tag>.json (the state card per frame, ms per frame).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2), mode = argv[0], demo = argv[1];
const kv = Object.fromEntries(argv.filter(a => a.includes('=')).map(a => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
const OUTD = path.resolve(ROOT, kv.out || 'review/studio_type_c2/after'); fs.mkdirSync(OUTD, { recursive: true });
const tag = kv.tag || demo;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => { const s = m.text(); if (!/GPU stall|GL Driver|toNonIndexed/i.test(s)) console.log('[page]', s.slice(0, 400)); });
page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
const T0 = Date.now();
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${kv.page || 'lab_type_c2'}.html?demo=${demo}${kv.query || ''}`);
page.on('pageerror', e => page.evaluate(m => { window.sceneError = m; }, e.message).catch(() => {}));
await page.waitForFunction(() => window.sceneReady === true || window.sceneError, null, { timeout: 1800000, polling: 1000 });
const err = await page.evaluate(() => window.sceneError); if (err) { console.error('scene error', err); process.exit(2); }
console.log(`ready in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
const canvas = await page.$('#out');
const grab = () => canvas.screenshot({ type: 'jpeg', quality: 93, timeout: 600000 });
const info = { demo, tag, readyS: +((Date.now() - T0) / 1000).toFixed(1), frames: [] };
const card = t => page.evaluate(tt => window.typeC2 ? window.typeC2(tt) : null, t);
if (mode === 'still') {
  const ts = (kv.t || '0').split(',').map(Number);
  for (const t of ts) {
    const t1 = Date.now(); await page.evaluate(tt => window.renderFrame(tt), t);
    const name = `${tag}${ts.length > 1 ? '_t' + t : ''}.jpg`; fs.writeFileSync(path.join(OUTD, name), await grab());
    info.frames.push({ t, wallMs: Date.now() - t1, card: await card(t) }); console.log(name, Date.now() - t1, 'ms');
  }
} else if (mode === 'clip') {
  const n = +(kv.frames || 60), fps = 30, a0 = +(kv.a0 || 0);
  const ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  const wav = kv.wav ? path.resolve(ROOT, kv.wav) : null;
  const out = path.join(OUTD, `${tag}.mp4`);
  const aargs = wav && fs.existsSync(wav) ? ['-ss', String(a0), '-t', String(n / fps), '-i', wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : [];
  const enc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', ...aargs,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(fps), '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const hs = kv.strip != null ? +kv.strip : null, hf = hs != null ? Math.round((hs - a0) * fps) : null;
  const sdir = path.join(OUTD, `${tag}_frames`); if (hf != null) fs.mkdirSync(sdir, { recursive: true });
  for (let i = 0; i < n; i++) {
    const t = a0 + i / fps, t1 = Date.now(); await page.evaluate(tt => window.renderFrame(tt), t);
    const jpg = await grab(); if (!enc.stdin.write(jpg)) await new Promise(r => enc.stdin.once('drain', r));
    if (hf != null && i >= hf - 8 && i <= hf + 8) fs.writeFileSync(path.join(sdir, `f${String(i - hf).replace('-', 'm')}.jpg`), jpg);
    info.frames.push({ i, t: +t.toFixed(4), wallMs: Date.now() - t1, card: await card(t) });
    if (i % 10 === 0) console.log(`${tag} frame ${i}/${n} ${Date.now() - t1} ms`);
  }
  enc.stdin.end(); await new Promise(r => enc.on('close', r));
  info.clip = out; info.a0 = a0; info.hitFrame = hf; console.log('wrote', out);
}
fs.writeFileSync(path.join(OUTD, `${tag}.json`), JSON.stringify(info, null, 1));
await browser.close(); server.close();
