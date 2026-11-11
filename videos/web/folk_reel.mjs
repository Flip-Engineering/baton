// The HUMAN studio c3 people reel (scenes/lab_folk.html): node web/folk_reel.mjs crowd_mid:raw crowd_mid:NOTAN ...
//   node web/human_reel.mjs profile:lit hand:rim crowd:print ...          (subject:mode[:t][?extra=query])
//   node web/human_reel.mjs --clip rider:rim:0:3                           (subject:mode:t0:seconds -> mp4, 30 fps)
//   --out <dir>   (default videos/review/studio_human_c1/after)
// Each job logs window.labInfo (the shot's pass/fail measurements) to <out>/checks.jsonl.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const OUT = path.resolve(opt('out', path.join(ROOT, 'review', 'studio_human_c3', 'after')));
const clip = opt('clip', null);
const PAGE = opt('page', 'lab_folk');   // HUMAN c4: --page lab_people4 (the c4 reel); default unchanged
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.bvh': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const open = async (subject, mode, extra) => {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('console', m => console.log('[page]', m.text())); page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/web/scenes/${PAGE}.html?subject=${subject}&mode=${mode}${extra ? '&' + extra : ''}`);
  await page.waitForFunction(() => window.sceneReady === true || window.sceneError, null, { timeout: 240000 });
  const err = await page.evaluate(() => window.sceneError); if (err) throw new Error(err);
  return page;
};
const grab = async page => (await page.$('#out')).screenshot({ type: 'jpeg', quality: 93, timeout: 600000 });
const log = fs.createWriteStream(path.join(OUT, 'checks.jsonl'), { flags: 'a' });

if (clip) {
  const [subject, mode, t0s, durs] = clip.split(':'); const t0 = +t0s || 0, dur = +durs || 3, FPS = 30;
  const [mode_, cextra = ''] = mode.split('?'); const page = await open(subject, mode_, cextra);   // c4: subject:mode?extra:t0:dur
  const ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  const file = path.join(OUT, `clip_${subject}_${mode_}${new URLSearchParams(cextra).get('tag') ? '_' + new URLSearchParams(cextra).get('tag') : ''}.mp4`);
  const enc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const tS = Date.now();
  for (let k = 0; k < Math.round(dur * FPS); k++) {
    await page.evaluate(t => window.renderFrame(t), t0 + k / FPS);
    const buf = await grab(page); if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
    if (k % 15 === 0) console.log(`frame ${k} ${((Date.now() - tS) / 1000 / (k + 1)).toFixed(2)} s/frame`);
  }
  enc.stdin.end(); await new Promise(r => enc.on('close', r));
  console.log('clip ->', file);
} else {
  for (const job of args) {
    const [main, extra = ''] = job.split('?'); const [subject, mode, ts = '1'] = main.split(':');
    const tag = new URLSearchParams(extra).get('tag');
    const t0 = Date.now();
    try {
      const page = await open(subject, mode, extra);
      const info = await page.evaluate(t => window.renderFrame(t), +ts);
      const name = `${subject}_${mode}${tag ? '_' + tag : ''}.jpg`;
      fs.writeFileSync(path.join(OUT, name), await grab(page));
      const row = { job, file: name, s: ((Date.now() - t0) / 1000).toFixed(1), ...(info || {}), ...(await page.evaluate(() => window.labInfo || {})) };
      console.log(JSON.stringify(row)); log.write(JSON.stringify(row) + '\n');
      await page.close();
    } catch (e) { console.error('job failed', job, e.message); }
  }
}
await browser.close(); server.close();
