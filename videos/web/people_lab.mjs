// Stills + timing for scenes/lab_people.html (old person() vs lib/fx/people.js).
//   node web/people_lab.mjs                       -> videos/review/people_lab/*.jpg + timing table
//   node web/people_lab.mjs new:close old:crowd   (who:shot[:n[:sc]] ...)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..'), OUT = path.join(ROOT, 'review', 'people_lab');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const jobs = (process.argv.slice(2).length ? process.argv.slice(2) : ['old:close', 'new:close', 'old:crowd:400', 'new:crowd:400', 'new:trades', 'new:walk', 'new:crowd:400:0.75', 'old:crowd:400:0.75'])
  .map(s => { const [main, extra = ''] = s.split('?'); const [who, shot, n = 400, sc = 1, tag = ''] = main.split(':'); return { who, shot, n: +n, sc: +sc, extra, tag }; });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const rows = [];
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('console', m => console.log('[page]', m.text())); page.on('pageerror', e => console.error('[pageerror]', e.message));
  const tL = Date.now();
  await page.goto(`http://127.0.0.1:${port}/web/scenes/lab_people.html?who=${j.who}&shot=${j.shot}&n=${j.n}&sc=${j.sc}${j.extra ? '&' + j.extra : ''}`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 60000 });
  const load = (Date.now() - tL) / 1000;
  const T = [1.0, 1.1, 1.2, 1.3, 1.4, 2.35];
  const res = []; for (const t of T) res.push(await page.evaluate(t => window.renderFrame(t), t));
  const warm = res.slice(1, 5), ms = warm.reduce((a, r) => a + r.ms, 0) / warm.length, cpu = warm.reduce((a, r) => a + r.cpu, 0) / warm.length;
  const name = `${j.who}_${j.shot}${j.shot === 'crowd' ? '_' + j.n : ''}${j.sc !== 1 ? '_sc' + j.sc : ''}${j.tag ? '_' + j.tag : ''}.jpg`;
  const buf = await (await page.$('#out')).screenshot({ type: 'jpeg', quality: 92 });
  fs.writeFileSync(path.join(OUT, name), buf);
  const strip = new URLSearchParams(j.extra).get('strip');
  if (strip) {   // a contact strip of frames at the given times (seconds), for motion review
    const ts = strip.split(',').map(Number), files = [];
    for (const [k, t] of ts.entries()) { await page.evaluate(t => window.renderFrame(t), t); const f = path.join(OUT, `.strip_${k}.jpg`); fs.writeFileSync(f, await (await page.$('#out')).screenshot({ type: 'jpeg', quality: 90 })); files.push(f); }
    const { execFileSync } = await import('node:child_process');
    execFileSync('python3', ['-c', `import sys\nfrom PIL import Image\nims=[Image.open(f) for f in sys.argv[2:]]\nw,h=ims[0].size\ns=Image.new('RGB',(w*len(ims),h))\nfor i,im in enumerate(ims): s.paste(im,(w*i,0))\ns.resize((w*len(ims)//3,h//3)).save(sys.argv[1],quality=90)`, path.join(OUT, name.replace('.jpg', '_strip.jpg')), ...files]);
    for (const f of files) fs.unlinkSync(f);
  }
  const info = await page.evaluate(() => window.labInfo);
  const row = { job: `${j.who}:${j.shot}:${j.n}:${j.sc}`, still: path.join(OUT, name), load_s: load.toFixed(1), first_ms: res[0].ms.toFixed(0), frame_ms: ms.toFixed(0), people_cpu_ms: cpu.toFixed(1), calls: res[4].calls, tris: res[4].tris, lod: res[4].drawn, verts: info.verts };
  console.log(JSON.stringify(row)); rows.push(row);
  await page.close();
}
fs.writeFileSync(path.join(OUT, 'timing.json'), JSON.stringify(rows, null, 1));
await browser.close(); server.close();
