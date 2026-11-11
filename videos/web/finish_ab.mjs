// FINISH A/B (STUDIO FINISH c1): render the same scene moments through two versions of the shared finish, so a
// change to post.js / kit.js / the encode can be judged on real pieces, not test charts.
//
//   node web/finish_ab.mjs <scene> --stills 3,12.5 --tag after --out review/x            -> <out>/<tag>_<scene>_<t>.png
//   node web/finish_ab.mjs <scene> --clip 10:13 --tag before --chain old --out review/x  -> <out>/<tag>_<scene>_10-13.mp4
//   --override web/lib/fx/post.js=/abs/old_post.js   serve another file at that path (repeatable): the "before" side
//   --chain old  the grab + encode render.mjs used before 1 Oct (JPEG q93 grab, x264 crf 19, untagged BT.601)
//   --chain new  the current render.mjs grab + encode (lossless PNG grab, BT.709 conversion + tags; see enc_args)
// Stills are lossless PNG grabs of #out. Uses the light render lane (stills) or a heavy lane (clips).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleCache } from './cache_server.mjs';
import { acquire as acquireSlot } from './render_slot.mjs';
import { master as masterArgs } from './enc_args.mjs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const W = 1080, H = 1920, FPS = 30;
const args = process.argv.slice(2), scene = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const over = new Map();
args.forEach((a, i) => { if (a === '--override') { const [u, f] = args[i + 1].split('='); over.set('/' + u.replace(/^\//, ''), f); } });
const tag = opt('tag', 'x'), outDir = path.resolve(ROOT, opt('out', 'out/finish_ab')), chain = opt('chain', 'new');
fs.mkdirSync(outDir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  if (handleCache(req, res, ROOT)) return;
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = over.get(u) || path.join(ROOT, u);
  if (!over.has(u) && (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory())) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const stills = opt('stills') ? opt('stills').split(',').map(Number) : null;
const clip = opt('clip') ? opt('clip').split(':').map(Number) : null;
if (!stills && !clip) { console.error('finish_ab: --stills or --clip'); process.exit(2); }
await acquireSlot({ kind: stills ? 'light' : 'heavy', label: `finish_ab ${args.join(' ')}` });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/web/scenes/${scene}.html${opt('query', '')}`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 180000 });
const canvas = await page.$('#out');
if (stills) {
  for (const t of stills) {
    await page.evaluate(tt => window.renderFrame(tt), t);
    fs.writeFileSync(path.join(outDir, `${tag}_${scene}_${t.toFixed(2)}.png`), await canvas.screenshot({ type: 'png', timeout: 600000 }));
    console.log(`${tag} ${scene} ${t}`);
  }
} else {
  const [from, to] = clip;
  const ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  const file = path.join(outDir, `${tag}_${scene}_${from}-${to}.mp4`);
  const old = chain === 'old';
  const venc = old ? ['-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-profile:v', 'high']
    : masterArgs();
  const enc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', old ? 'mjpeg' : 'png', '-i', '-',
    '-ss', String(from), '-t', String(to - from), '-i', path.join(ROOT, 'out', `.${scene}.wav`), '-map', '0:v', '-map', '1:a',
    ...venc, '-r', String(FPS), '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = Math.round(from * FPS); i < Math.round(to * FPS); i++) {
    await page.evaluate(tt => window.renderFrame(tt), i / FPS);
    const buf = await canvas.screenshot(old ? { type: 'jpeg', quality: 93, timeout: 600000 } : { type: 'png', timeout: 600000 });
    if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
  }
  enc.stdin.end(); await new Promise(r => enc.on('close', r));
  console.log('wrote', file);
}
await browser.close(); server.close();
