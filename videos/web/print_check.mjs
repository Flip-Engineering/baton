// Bench + determinism check for a scene (made for lab_print / lib/fx/print.js, works for any scene).
//
//   node web/print_check.mjs lab_print --bench 8.5,17.6          render each t cold then warm: wall ms, and CPU ms of the
//                                                                 browser's GPU + renderer processes (load-independent work;
//                                                                 on a shared box wall time mostly measures the neighbours)
//   node web/print_check.mjs lab_print --hash 20.4,21.9,26.1     cold/warm regression: frame t rendered on a fresh page
//                                                                 must hash the same as frame t rendered after other frames
//                                                                 (seeking with --from must not depend on the SHEETS cache)
// Needs out/.<scene>.hits.json (any render.mjs run of the scene writes it). Exit code 1 on a hash mismatch.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2), scene = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const list = k => (opt(k) || '').split(',').filter(Boolean).map(Number);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
async function open(query = '') {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (!opt('quiet')) console.log('[page]', m.text()); });
  page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
  await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${scene}.html${query}`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 180000 });
  return page;
}
const frameAt = t => Math.round(t * 30) / 30;
// CPU time (ms) of every process under the browser (SwiftShader runs in the GPU process)
const TCK = Number(execSync('getconf CLK_TCK').toString()) || 100;
function cpuMs() {
  const kids = new Set([process.pid]);            // everything under this node process = the browser
  const ps = execSync('ps -e -o pid=,ppid=').toString().trim().split('\n').map(l => l.trim().split(/\s+/).map(Number));
  for (let k = 0; k < 5; k++) for (const [p, pp] of ps) if (kids.has(pp)) kids.add(p);
  kids.delete(process.pid); let t = 0; for (const p of kids) { try { const f = fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' '); t += (Number(f[11]) + Number(f[12])) * 1000 / TCK; } catch {} }
  return t;
}
const render = (page, t) => page.evaluate(async t => { const a = performance.now(); await window.renderFrame(t); return performance.now() - a; }, frameAt(t));
const hash = page => page.evaluate(() => {
  const c = document.getElementById('out'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < d.length; i += 4) { h1 = Math.imul(h1 ^ d[i] ^ (d[i + 1] << 8) ^ (d[i + 2] << 16), 16777619); h2 = (h2 + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7) >>> 0; }
  return (h1 >>> 0).toString(16) + ':' + h2.toString(16);
});

if (opt('bench')) {
  const page = await open('?profile=1');
  let sw = 0, sc = 0, n = 0;
  for (const t of list('bench')) {
    const cold = await render(page, t), c0 = cpuMs(), warm = await render(page, t), cpu = cpuMs() - c0;
    sw += warm; sc += cpu; n++;
    console.log(`bench t=${frameAt(t).toFixed(3)} cold=${cold.toFixed(0)}ms warm=${warm.toFixed(0)}ms warm-cpu=${cpu.toFixed(0)}ms`);
  }
  const la = fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
  console.log(`bench mean warm=${(sw / n).toFixed(0)}ms/frame cpu=${(sc / n).toFixed(0)}ms/frame (cpu/4 = ${(sc / n / 4).toFixed(0)}ms: ideal 4-core wall) load=${la}`);
}
if (opt('hash')) {
  let bad = 0;
  for (const t of list('hash')) {
    const cold = await open(); await render(cold, t); const hc = await hash(cold); await cold.close();
    const warm = await open();                                     // warm: play into t from 3 s earlier (fills caches), then t
    for (let u = Math.max(0, t - 3); u < t - 1e-6; u += 0.5) await render(warm, u);
    await render(warm, t); const hw = await hash(warm);
    await render(warm, t); const hw2 = await hash(warm); await warm.close();
    const ok = hc === hw && hw === hw2; if (!ok) bad++;
    console.log(`hash t=${frameAt(t).toFixed(3)} cold=${hc} warm=${hw} again=${hw2} ${ok ? 'OK' : 'MISMATCH'}`);
  }
  console.log(bad ? `determinism: ${bad} MISMATCH` : 'determinism: all OK');
  if (bad) process.exitCode = 1;
}
await browser.close(); server.close();
