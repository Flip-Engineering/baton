// LOOKS studio c1 reel driver: stills of scenes/lab_looks.html (3 sources x 8 looks, cost per look) and the three clips.
//   node web/looks_reel.mjs stills [--looks A,B] [--sources plant,crowd] [--reps 3]
//   node web/looks_reel.mjs clip 1|2|3
//   --out <dir> (default videos/review/studio_looks_c1/after)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleCache } from './cache_server.mjs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt('out', path.join(ROOT, 'review', 'studio_looks_c1', 'after')));
fs.mkdirSync(path.join(OUT, 'stills'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'clips'), { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  if (handleCache(req, res, ROOT)) return;
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const open = async (q) => {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('console', m => console.log('[page]', m.text().slice(0, 400))); page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/web/scenes/lab_looks.html${q}`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 300000 });
  return page;
};
const grab = async page => (await page.$('#out')).screenshot({ type: 'jpeg', quality: 94, timeout: 600000 });
const mode = args[0];
if (mode === 'stills') {
  const page = await open('');
  const LOOKS = (opt('looks') || 'KLUTSIS,SERIGRAPH,INTAGLIO,RISO,NEWSREEL,BROADSIDE,SODIUM,NOTAN').split(',');
  const SRCS = (opt('sources') || 'plant,crowd,payoff').split(','), reps = +opt('reps', 3);
  const cost = {};
  for (const s of SRCS) {
    await page.evaluate(n => window.raw(n), s); fs.writeFileSync(path.join(OUT, 'stills', `${s}_SOURCE.jpg`), await grab(page));
    for (const L of LOOKS) {
      const ms = [];
      for (let r = 0; r < reps; r++) ms.push(await page.evaluate(([n, l, t]) => window.still(n, l, t), [s, L, 0.5 + r / 30]));
      fs.writeFileSync(path.join(OUT, 'stills', `${s}_${L}.jpg`), await grab(page));
      ms.sort((a, b) => a - b); (cost[L] ||= {})[s] = Math.round(ms[Math.floor(ms.length / 2)]);
      console.log(s, L, cost[L][s], 'ms');
    }
  }
  const f = path.join(OUT, 'cost.json'); let prev = {}; try { prev = JSON.parse(fs.readFileSync(f)); } catch (e) { /* first */ }
  for (const [L, v] of Object.entries(cost)) prev[L] = { ...(prev[L] || {}), ...v };
  fs.writeFileSync(f, JSON.stringify(prev, null, 1));
} else if (mode === 'clip') {
  const n = args[1], page = await open(`?clip=${n}`);
  const CL = await page.evaluate(() => window.clipInfo);
  const FPS = 30, N = 60, ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  const names = { 1: 'clip1_plant_SODIUM_to_KLUTSIS', 2: 'clip2_crowd_RISO_to_SERIGRAPH', 3: 'clip3_payoff_INTAGLIO_stamp_NEWSREEL_splice' };
  const file = path.join(OUT, 'clips', names[n] + '.mp4');
  const wav = path.join(ROOT, 'out', `.${CL.song}.wav`);
  const fdir = path.join(OUT, 'clips', 'frames' + n); fs.mkdirSync(fdir, { recursive: true });
  const enc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-ss', String(CL.t0), '-t', '2', '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now(), ms = [];
  for (let k = 0; k < N; k++) {
    const a = Date.now(); await page.evaluate(t => window.renderFrame(t), k / FPS); ms.push(Date.now() - a);
    const buf = await grab(page); fs.writeFileSync(path.join(fdir, `${String(k).padStart(2, '0')}.jpg`), buf);
    if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
  }
  enc.stdin.end(); await new Promise(r => enc.on('close', r));
  ms.sort((a, b) => a - b);
  const hitF = Math.round(CL.hit * FPS) - Math.round(CL.t0 * FPS);
  const info = { clip: n, file, song: CL.song, t0: CL.t0, hit: CL.hit, hit_frame: hitF, hit2_frame: CL.hit2 ? Math.round(CL.hit2 * FPS) - Math.round(CL.t0 * FPS) : null, median_ms: ms[N >> 1], total_s: (Date.now() - t0) / 1000 };
  fs.writeFileSync(path.join(OUT, 'clips', names[n] + '.json'), JSON.stringify(info, null, 1));
  console.log(JSON.stringify(info));
}
await browser.close(); server.close();
