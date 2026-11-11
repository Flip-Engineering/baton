// PLATE c1 driver: the lab_plate demos as stills or clips on SONG time, through the delivery chain of web/render.mjs
// (canvas -> JPEG q93 -> libx264 crf 19 preset slow yuv420p high, 30 fps) and then the share generation of
// scripts/collect.sh (8 Mbit/s, maxrate 16, preset medium). A still is judged after that chain too: it is rendered as a
// 3-frame clip and the middle frame decoded from the share file.
//   node videos/scripts/plate_reel.mjs still trucker t=0.4,1.9 [out=review/studio_plate_c1/after] [tag=..] [query=&scale=2.4]
//   node videos/scripts/plate_reel.mjs clip tapper a0=19.3 frames=108 wav=out/.frontier3.wav [tag=..]
// Writes <out>/<tag>_t<T>_share.png (decoded share frame), <out>/<tag>.mp4 + <tag>_share.mp4 for clips (the caller
// sheets and deletes them: scripts/plate_sheets.py), and <tag>.json (ms per frame, bytes, the page's state per frame).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquire as acquireSlot } from '../web/render_slot.mjs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2), mode = argv[0], demo = argv[1];
const kv = Object.fromEntries(argv.filter(a => a.includes('=')).map(a => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
const OUTD = path.resolve(ROOT, kv.out || 'review/studio_plate_c1/after'); fs.mkdirSync(OUTD, { recursive: true });
const tag = kv.tag || demo;
const FF = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
{ const st = fs.statfsSync(OUTD), free = st.bavail * st.bsize / 1e9, need = mode === 'clip' ? 0.2 : 0.1;
  if (free < need) { console.error(`plate_reel: ${free.toFixed(2)} GB free, need ${need}`); process.exit(3); } }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
if (!argv.includes('--no-slot')) await acquireSlot({ kind: mode === 'still' ? 'light' : 'heavy', label: `plate_reel ${argv.join(' ')}` });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => { const s = m.text(); if (!/GPU stall|GL Driver/i.test(s)) console.log('[page]', s.slice(0, 400)); });
page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; page.evaluate(m => { window.sceneError = m; }, e.message).catch(() => {}); });
const T0 = Date.now();
await page.goto(`http://127.0.0.1:${server.address().port}/web/labs/plate/lab_plate.html?demo=${demo}${kv.query || ''}`);
await page.waitForFunction(() => window.sceneReady === true || window.sceneError, null, { timeout: 600000, polling: 500 });
if (await page.evaluate(() => window.sceneError)) { console.error('scene error; stopping'); process.exit(2); }
const canvas = await page.$('#out');
const grab = () => canvas.screenshot({ type: 'jpeg', quality: 93, timeout: 600000 });
const info = { demo, tag, readyS: +((Date.now() - T0) / 1000).toFixed(1), frames: [] };
const enc = (inArgs, file) => spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', ...inArgs,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', '30', ...(inArgs.length ? ['-c:a', 'aac', '-b:a', '256k', '-shortest'] : []), '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
const share = (mp4, out) => execFileSync(FF, ['-y', '-loglevel', 'error', '-i', mp4, '-c:v', 'libx264', '-b:v', '8000k', '-maxrate', '16000k', '-bufsize', '16000k', '-preset', 'medium', '-c:a', 'copy', out]);
async function run(t0, n, file, audio) {
  const e = enc(audio ? ['-ss', String(t0), '-i', audio, '-map', '0:v', '-map', '1:a'] : [], file);
  for (let i = 0; i < n; i++) {
    const t = t0 + i / 30, t1 = Date.now();
    await page.evaluate(tt => window.renderFrame(tt), t);
    const buf = await grab(); if (!e.stdin.write(buf)) await new Promise(r => e.stdin.once('drain', r));
    info.frames.push({ t: +t.toFixed(3), ms: Date.now() - t1, state: await page.evaluate(() => window.plateState ? { ...window.plateState, subj: undefined } : null) });
  }
  e.stdin.end(); await new Promise(r => e.on('close', r));
}
if (mode === 'still') {
  for (const t of (kv.t || '0').split(',').map(Number)) {
    const mp4 = path.join(OUTD, `_${tag}_t${t}.mp4`), sh = mp4.replace('.mp4', '_share.mp4');
    await run(t - 1 / 30, 3, mp4, null); share(mp4, sh);
    execFileSync(FF, ['-y', '-loglevel', 'error', '-i', sh, '-vf', 'select=eq(n\\,1)', '-frames:v', '1', path.join(OUTD, `${tag}_t${t}_share.png`)]);
    fs.unlinkSync(mp4); fs.unlinkSync(sh); console.log(`${tag}_t${t}_share.png`);
  }
} else {
  const n = +(kv.frames || 60), a0 = +(kv.a0 || 0), wav = kv.wav ? path.resolve(ROOT, kv.wav) : null;
  const mp4 = path.join(OUTD, `${tag}.mp4`), sh = path.join(OUTD, `${tag}_share.mp4`);
  await run(a0, n, mp4, wav); share(mp4, sh);
  info.bytes = { crf19: fs.statSync(mp4).size, share: fs.statSync(sh).size }; info.a0 = a0; info.n = n;
  console.log(`${tag}: ${n} frames, crf19 ${(info.bytes.crf19 * 8 / (n / 30) / 1e6).toFixed(2)} Mbit/s, share ${(info.bytes.share * 8 / (n / 30) / 1e6).toFixed(2)} Mbit/s`);
}
info.msPerFrame = Math.round(info.frames.reduce((a, f) => a + f.ms, 0) / Math.max(1, info.frames.length));
fs.writeFileSync(path.join(OUTD, `${tag}.json`), JSON.stringify(info, null, 1));
await browser.close(); server.close();
