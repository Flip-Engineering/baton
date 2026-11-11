// WORLDS c2 reel driver: lab_worlds_c2 shots as stills and clips, several looks from ONE bake (the plate is relit, not re-rendered).
//   node videos/scripts/worlds_c2.mjs still storm looks=raw,STORM_MONO t=1.5,1.6 [out=review/studio_worlds_c2/after] [query=&n=8] [tag=storm]
//   node videos/scripts/worlds_c2.mjs clip storm looks=raw,STORM_MONO,BROADSIDE frames=90 a0=1.5 [wav=path] [keep=40-52]
// Writes <out>/<tag>_<look>.jpg | .mp4 and <tag>.json (shot card, bake stats, per-frame ms). One Chromium (SwiftShader).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2), mode = argv[0], shot = argv[1];
const kv = Object.fromEntries(argv.filter(a => a.includes('=')).map(a => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
const OUTD = path.resolve(ROOT, kv.out || 'review/studio_worlds_c2/after'); fs.mkdirSync(OUTD, { recursive: true });
const looks = (kv.looks || 'raw').split(','), tag = kv.tag || shot;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.bin': 'application/octet-stream', '.bvh': 'text/plain' };
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
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${kv.page || 'lab_worlds_c2'}.html?shot=${shot}${kv.query || ''}`);
await page.waitForFunction(() => window.sceneReady === true || window.sceneError, null, { timeout: 1800000, polling: 1000 });
const err = await page.evaluate(() => window.sceneError); if (err) { console.error('scene error', err); process.exit(2); }
console.log(`ready in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
const canvas = await page.$('#out');
const grab = () => canvas.screenshot({ type: 'jpeg', quality: 93, timeout: 600000 });
const info = { tag, readyS: +((Date.now() - T0) / 1000).toFixed(1), frames: [] };
if (mode === 'still') {
  for (const t of (kv.t || '0').split(',').map(Number)) for (const lk of looks) {
    const t1 = Date.now(); const fi = await page.evaluate(([tt, l]) => { window.renderFrame(tt, { look: l }); return window.shotInfo().stats; }, [t, lk]);
    const name = `${tag}_${lk}${(kv.t || '0').includes(',') ? '_t' + t : ''}.jpg`; fs.writeFileSync(path.join(OUTD, name), await grab());
    info.frames.push({ t, look: lk, wallMs: Date.now() - t1, ...fi }); console.log(name, Date.now() - t1, 'ms');
  }
} else if (mode === 'clip') {
  const n = +(kv.frames || 90), fps = 30, a0 = +(kv.a0 || 0);
  const ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  const wav = kv.wav ? path.resolve(ROOT, kv.wav) : null;
  const [k0, k1] = (kv.keep || '-1--1').split('-').map(Number);
  const enc = {};
  for (const lk of looks) {
    const out = path.join(OUTD, `${tag}_${lk}.mp4`);
    const aargs = wav && fs.existsSync(wav) ? ['-ss', String(a0), '-t', String(n / fps), '-i', wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : [];
    enc[lk] = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', ...aargs,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(fps), '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  }
  const tc = Date.now();
  for (let i = 0; i < n; i++) for (const lk of looks) {
    const t1 = Date.now(); const fi = await page.evaluate(([tt, l]) => { window.renderFrame(tt, { look: l }); return window.shotInfo().stats; }, [i / fps, lk]);
    const jpg = await grab(); enc[lk].stdin.write(jpg);
    if (i >= k0 && i <= k1) fs.writeFileSync(path.join(OUTD, `${tag}_${lk}_f${String(i).padStart(2, '0')}.jpg`), jpg);
    info.frames.push({ i, look: lk, wallMs: Date.now() - t1, frameMs: fi?.frameMs, compMs: fi?.compMs });
    if (i % 10 === 0) console.log(`frame ${i}/${n} ${lk} ${Date.now() - t1} ms`);
  }
  for (const lk of looks) { enc[lk].stdin.end(); await new Promise(r => enc[lk].on('close', r)); }
  info.wallMsPerFrame = Math.round((Date.now() - tc) / n / looks.length);
}
Object.assign(info, await page.evaluate(() => { const I = window.shotInfo(); return { card: I.card, bake: I.bake, subject: I.subject, cam: I.cam, extra: I.extra }; }));
fs.writeFileSync(path.join(OUTD, `${tag}.json`), JSON.stringify(info, null, 1));
console.log('done', tag, JSON.stringify(info.bake));
await browser.close(); server.close();
