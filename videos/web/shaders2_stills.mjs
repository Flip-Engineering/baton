// Stills + per-stage timing for scenes/lab_shaders2.html (the shaders2 family: atmos, flesh, engrave, paint, fields).
//   node web/shaders2_stills.mjs                         -> every shot at t=1 into videos/review/lab_shaders2/
//   node web/shaders2_stills.mjs giant profile?flesh=0   (shot[@t][?query] ...; name gets the query as a suffix)
//   STRIP=0,0.5,1 node web/shaders2_stills.mjs engrave?turn=1   -> also a motion strip at those times
//   SHEET=1 node web/shaders2_stills.mjs                 -> rebuild contact_sheet.jpg from the stills on disk only
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..'), OUT = path.join(ROOT, 'review', 'lab_shaders2');
fs.mkdirSync(OUT, { recursive: true });
const ALL = ['giant', 'profile?flesh=0', 'profile', 'cones', 'engrave', 'molten', 'rust', 'paint'];

function sheet() {
  const order = ['giant', 'cones', 'profile_flesh0', 'profile', 'engrave', 'molten', 'rust', 'paint', 'paint_raw1'];
  const files = order.map(n => path.join(OUT, n + '.jpg')).filter(f => fs.existsSync(f));
  const labels = files.map(f => path.basename(f, '.jpg'));
  execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw, ImageFont
out, n = sys.argv[1], (len(sys.argv) - 2) // 2
fs, ls = sys.argv[2:2 + n], sys.argv[2 + n:]
cw, ch, pad = 360, 640, 12
cols = 5; rows = (n + cols - 1) // cols
S = Image.new('RGB', (cols * (cw + pad) + pad, rows * (ch + 44 + pad) + pad), (14, 10, 10))
d = ImageDraw.Draw(S)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except Exception: font = ImageFont.load_default()
for i, (f, l) in enumerate(zip(fs, ls)):
  im = Image.open(f).convert('RGB').resize((cw, ch), Image.LANCZOS)
  x, y = pad + (i % cols) * (cw + pad), pad + (i // cols) * (ch + 44 + pad)
  S.paste(im, (x, y)); d.text((x + 4, y + ch + 8), l, fill=(244, 230, 208), font=font)
S.save(out, quality=90)
`, path.join(OUT, 'contact_sheet.jpg'), ...files, ...labels]);
  console.log('sheet', path.join(OUT, 'contact_sheet.jpg'));
}
if (process.env.SHEET) { sheet(); process.exit(0); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const jobs = (process.argv.slice(2).length ? process.argv.slice(2) : ALL).map(s => {
  const [main, q = ''] = s.split('?'); const [shot, t = '1'] = main.split('@');
  const suffix = q ? '_' + q.replace(/[=&]/g, '').replace(/[^a-z0-9_.]/gi, '') : '';
  return { shot, t: +t, q, name: shot + suffix + (main.includes('@') ? '_t' + t : '') };
});
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const rows = [];
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('console', m => console.log('[page]', m.text().slice(0, 400))); page.on('pageerror', e => console.error('[pageerror]', e.message));
  const tL = Date.now();
  await page.goto(`http://127.0.0.1:${port}/web/scenes/lab_shaders2.html?shot=${j.shot}${j.q ? '&' + j.q : ''}`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 300000 });
  const load = (Date.now() - tL) / 1000;
  const first = await page.evaluate(t => window.renderFrame(t), j.t);            // compiles
  const warm = await page.evaluate(t => window.renderFrame(t), j.t);
  const buf = await (await page.$('#out')).screenshot({ type: 'jpeg', quality: 93 });
  fs.writeFileSync(path.join(OUT, j.name + '.jpg'), buf);
  let prof = {}; try { prof = await page.evaluate(t => window.profileFrame(t), j.t); } catch (e) { prof = { err: String(e) }; }
  if (process.env.STRIP) {
    const ts = process.env.STRIP.split(',').map(Number), files = [];
    for (const [k, t] of ts.entries()) { await page.evaluate(t => window.renderFrame(t), t); const f = path.join(OUT, `.strip_${k}.jpg`); fs.writeFileSync(f, await (await page.$('#out')).screenshot({ type: 'jpeg', quality: 90 })); files.push(f); }
    execFileSync('python3', ['-c', `import sys\nfrom PIL import Image\nims=[Image.open(f) for f in sys.argv[2:]]\nw,h=ims[0].size\ns=Image.new('RGB',(w*len(ims),h))\nfor i,im in enumerate(ims): s.paste(im,(w*i,0))\ns.resize((w*len(ims)//3,h//3)).save(sys.argv[1],quality=90)`, path.join(OUT, j.name + '_strip.jpg'), ...files]);
    for (const f of files) fs.unlinkSync(f);
  }
  const row = { job: j.name, load_s: +load.toFixed(1), first_ms: Math.round(first.ms), frame_ms: Math.round(warm.ms), stages_ms: Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v])) };
  console.log(JSON.stringify(row)); rows.push(row);
  await page.close();
}
const tf = path.join(OUT, 'timing.json'); let old = []; try { old = JSON.parse(fs.readFileSync(tf, 'utf8')); } catch {}
const merged = [...old.filter(o => !rows.some(r => r.job === o.job)), ...rows];
fs.writeFileSync(tf, JSON.stringify(merged, null, 1));
await browser.close(); server.close();
sheet();
