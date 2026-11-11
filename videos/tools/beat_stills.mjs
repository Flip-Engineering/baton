// Stills by beat, no audio synth (the scene reads the beat grid from out/.<scene>.hits.json, so run make_audio.py first):
//   node tools/beat_stills.mjs <scene> <beat,beat,...> <outdir> [query] [bpm=144]   -> <outdir>/bNNN.NN.jpg
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [scene, beatsArg, outDir, query = "", bpm = "144"] = process.argv.slice(2);
const beats = beatsArg.split(',').map(Number);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => { const t = m.text(); if (!t.startsWith('[')) console.log('[page]', t); });
page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
const T0 = Date.now();
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${scene}.html${query}`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 600000, polling: 500 });
console.log('ready in', ((Date.now() - T0) / 1000).toFixed(1), 's');
const canvas = await page.$('#out'); fs.mkdirSync(outDir, { recursive: true });
const spb = 60 / Number(bpm);
for (const b of beats) {
  const t1 = Date.now();
  await page.evaluate(t => window.renderFrame(t), b * spb);
  fs.writeFileSync(path.join(outDir, `b${b.toFixed(2).padStart(6, '0')}.jpg`), await canvas.screenshot({ type: 'jpeg', quality: 90, timeout: 600000 }));
  console.log('b', b, ((Date.now() - t1) / 1000).toFixed(1), 's');
}
await browser.close(); server.close();
