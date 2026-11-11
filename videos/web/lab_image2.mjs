// Stills + timing for scenes/lab_image2.html (lib/fx/{montage,repro,project,imagelib}.js).
//   node web/lab_image2.mjs flag_storm:2.5 sparks_grind:1,1.5 ...     (shot:t[,t...][:sc][?query])
//   node web/lab_image2.mjs --sheet                                    (contact sheet of every still in review/lab_image2/)
// Writes videos/review/lab_image2/<shot>_<t>.jpg and appends to timing.json (setup ms, first frame ms, warm frame ms).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..'), OUT = path.join(ROOT, 'review', 'lab_image2');
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
if (args[0] === '--clip') {           // node web/lab_image2.mjs --clip shot from to [query]  -> review/lab_image2/<shot>_<from>-<to>.mp4 (silent)
  const [, shot, from, to, q = ''] = args;
  const { spawn } = await import('node:child_process');
  const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    const M = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
    res.writeHead(200, { 'Content-Type': M[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const br = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const pg = await br.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  pg.on('pageerror', e => console.error('[pageerror]', e.message));
  await pg.goto(`http://127.0.0.1:${srv.address().port}/web/scenes/lab_image2.html?shot=${shot}${q ? '&' + q : ''}`);
  await pg.waitForFunction(() => window.sceneReady === true, null, { timeout: 600000 });
  const ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  const file = path.join(OUT, `${shot}_${from}-${to}.mp4`);
  const enc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now(), n0 = Math.round(+from * 30), n1 = Math.round(+to * 30); let ms = 0;
  for (let i = n0; i < n1; i++) { const r = await pg.evaluate(t => window.renderFrame(t), i / 30); ms += r.ms;
    const buf = await (await pg.$('#out')).screenshot({ type: 'jpeg', quality: 93 }); if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r)); }
  enc.stdin.end(); await new Promise(r => enc.on('close', r));
  console.log(JSON.stringify({ clip: file, frames: n1 - n0, render_ms_mean: Math.round(ms / (n1 - n0)), wall_s: Math.round((Date.now() - t0) / 1000) }));
  await br.close(); srv.close(); process.exit(0);
}
if (args[0] === '--sheet') {
  execFileSync('python3', [path.join(HERE, '..', 'tools', 'image2_sheet.py'), OUT, ...args.slice(1)], { stdio: 'inherit' });
  process.exit(0);
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const tf = path.join(OUT, 'timing.json'); const rows = fs.existsSync(tf) ? JSON.parse(fs.readFileSync(tf)) : {};
for (const a of args) {
  const [main, extra = ''] = a.split('?'); const [shot, ts = '1', sc = '1', tag = ''] = main.split(':');
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('console', m => console.log('[page]', m.text())); page.on('pageerror', e => console.error('[pageerror]', e.message));
  const tL = Date.now();
  await page.goto(`http://127.0.0.1:${port}/web/scenes/lab_image2.html?shot=${shot}&sc=${sc}${extra ? '&' + extra : ''}`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 600000 });
  const load = Date.now() - tL, info = await page.evaluate(() => window.labInfo);
  const res = [];
  for (const t of ts.split(',').map(Number)) {
    const r = await page.evaluate(t => window.renderFrame(t), t);
    const r2 = await page.evaluate(t => window.renderFrame(t), t + 1 / 30);     // warm frame (the next frame)
    await page.evaluate(t => window.renderFrame(t), t);
    const name = `${shot}${tag ? '_' + tag : ''}_${t.toFixed(2)}.jpg`;
    fs.writeFileSync(path.join(OUT, name), await (await page.$('#out')).screenshot({ type: 'jpeg', quality: 92 }));
    res.push({ t, first: r.ms, warm: r2.ms, stats: r2.stats });
    console.log(JSON.stringify({ shot, tag, t, load_ms: load, setup_ms: info.setupMs, first_ms: r.ms, warm_ms: r2.ms, stats: r2.stats }));
  }
  rows[`${shot}${tag ? '_' + tag : ''}@${sc}`] = { load_ms: load, setup_ms: info.setupMs, frames: res };
  await page.close();
}
fs.writeFileSync(tf, JSON.stringify(rows, null, 1));
await browser.close(); server.close();
