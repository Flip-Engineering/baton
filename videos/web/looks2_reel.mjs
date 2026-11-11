// LOOKS c2 reel driver (scenes/lab_looks2.html and scenes/lab_adopt.html). One Chromium; waits are the caller's.
//   node web/looks2_reel.mjs stills close,mid,far raw,KLUTSIS,SERIGRAPH,...  [--out DIR] [--q extra=1]
//   node web/looks2_reel.mjs clip  mid squeegee --hit 7.047 --t0 5.65 --dur 2 --wav PATH [--from RISO] [--name N]
//   node web/looks2_reel.mjs page  lab_adopt.html?piece=giant --times 20.6,23.5 --tag giant   (stills of any lab page)
//   node web/looks2_reel.mjs pclip lab_adopt.html?piece=giant&look=... --t0 20 --dur 7 --wav PATH --name N
// Rows of window.labInfo go to <out>/checks.jsonl.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleCache } from './cache_server.mjs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const OUT = path.resolve(opt('out', path.join(ROOT, 'review', 'studio_looks_c2', 'after')));
const extra = opt('q', ''), hit = opt('hit', null), t0 = +opt('t0', 0), dur = +opt('dur', 2), wav = opt('wav', null), from = opt('from', null), name = opt('name', null);
const times = opt('times', '1').split(',').map(Number), tag = opt('tag', null), slide = opt('slide', null);
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.bvh': 'text/plain', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  if (handleCache(req, res, ROOT)) return;
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const log = fs.createWriteStream(path.join(OUT, 'checks.jsonl'), { flags: 'a' });
const open = async url => {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('console', m => { const s = m.text(); if (!/GPU stall|GL Driver|Texture has been resized/.test(s)) console.log('[page]', s.slice(0, 400)); });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/web/scenes/${url}`);
  await page.waitForFunction(() => (window.sceneReady === true && (!window.__adopt || window.adoptReady)) || window.sceneError, null, { timeout: 900000 });
  const err = await page.evaluate(() => window.sceneError); if (err) throw new Error(err);
  return page;
};
const grab = async (page, sel = '#out') => (await page.$(sel)).screenshot({ type: 'jpeg', quality: 93, timeout: 600000 });
const ffmpeg = () => execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
async function clipOf(page, file, render, n, sel) {
  const ff = ffmpeg(), tmp = file.replace(/\.mp4$/, '.v.mp4');
  const enc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
  const tS = Date.now();
  for (let k = 0; k < n; k++) {
    const info = await render(k);
    if (info) log.write(JSON.stringify({ file: path.basename(file), k, ...info }) + '\n');
    const buf = await grab(page, sel); if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
    if (k % 10 === 0) console.log(`frame ${k}/${n} ${((Date.now() - tS) / 1000 / (k + 1)).toFixed(2)} s/frame`, info ? JSON.stringify(info).slice(0, 160) : '');
  }
  enc.stdin.end(); await new Promise(r => enc.on('close', r));
  if (wav) execFileSync(ff, ['-y', '-loglevel', 'error', '-i', tmp, '-ss', String(t0), '-t', String(n / 30), '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', file]);
  else fs.renameSync(tmp, file);
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  console.log('clip ->', file);
}

const [cmd, a1, a2] = args;
if (cmd === 'stills') {
  for (const subject of a1.split(',')) {
    const page = await open(`lab_looks2.html?subject=${subject}&mode=KLUTSIS${extra ? '&' + extra : ''}`);
    for (const mode of a2.split(',')) {
      const tS = Date.now();
      await page.evaluate(m => window.setMode(m), mode);
      const info = await page.evaluate(t => window.renderFrame(t), times[0]);
      const file = `crowd_${subject}_${mode}${tag ? '_' + tag : ''}.jpg`;
      fs.writeFileSync(path.join(OUT, file), await grab(page));
      const row = { file, s: ((Date.now() - tS) / 1000).toFixed(1), ...info }; console.log(JSON.stringify(row)); log.write(JSON.stringify(row) + '\n');
    }
    await page.close();
  }
} else if (cmd === 'clip') {
  const page = await open(`lab_looks2.html?subject=${a1}&mode=SERIGRAPH&clip=${a2}&hit=${hit}${from ? '&from=' + from : ''}${slide ? '&slide=' + slide : ''}&marker=1${extra ? '&' + extra : ''}`);
  const n = Math.round(dur * 30);
  await clipOf(page, path.join(OUT, `${name || 'clip_' + a1 + '_' + a2}.mp4`), k => page.evaluate(t => window.renderFrame(t), t0 + k / 30), n);
} else if (cmd === 'page') {
  const page = await open(a1);
  for (const t of times) { const tS = Date.now(); const info = await page.evaluate(tt => window.renderFrame(tt), t);
    const file = `${tag || 'page'}_${t}.jpg`; fs.writeFileSync(path.join(OUT, file), await grab(page, opt('sel', '#out')));
    const row = { file, s: ((Date.now() - tS) / 1000).toFixed(1), ...(info || {}) }; console.log(JSON.stringify(row)); log.write(JSON.stringify(row) + '\n'); }
} else if (cmd === 'pclip') {
  const page = await open(a1); const n = Math.round(dur * 30);
  await clipOf(page, path.join(OUT, `${name || 'pclip'}.mp4`), k => page.evaluate(t => window.renderFrame(t), t0 + k / 30), n);
}
await browser.close(); server.close();
