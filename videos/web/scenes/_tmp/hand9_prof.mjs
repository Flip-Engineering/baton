// times one full-frame hand view with shader variants (uDebug 5: raster only, 6: no skin detail, 0: full), 3 reps each
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } }); page.setDefaultTimeout(900000);
await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/_tmp/hand9_lab.html`);
await page.waitForFunction(() => window.labReady === true, null, { timeout: 900000 });
const V = JSON.parse(process.argv[2]);
function treeCpu(root) { const kids = new Map(), cpu = new Map();
  for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; try { const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'), r = st.slice(st.lastIndexOf(')') + 2).split(' ');
    const pp = +r[1]; if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(+d); cpu.set(+d, (+r[11] + +r[12]) / 100); } catch (e) {} }
  let sum = 0; const st = [root]; while (st.length) { const p = st.pop(); sum += cpu.get(p) || 0; for (const c of kids.get(p) || []) st.push(c); } return sum; }
const bpid = process.pid;   // the browser tree hangs off this node process
for (let r = 0; r < 2; r++) for (const [dbg, sh, nh, mf, ns] of [[0, 1, 0, 1, 0], [0, 1, 0, 0, 1], [0, 1, 0, 0, 0]]) {
  const c0 = treeCpu(bpid), t0 = Date.now(); await page.evaluate(([v, d, sh, nh, mf, ns]) => { window.view([{ ...v, debug: d, shadow: sh, nohand: nh, minfs: mf, nosurf: ns }], 1); return window.labSync(); }, [V, dbg, sh, nh, mf, ns]); console.log(`minfs ${mf} nosurf ${ns}: ${Date.now() - t0} ms wall, ${(treeCpu(bpid) - c0).toFixed(2)} cpu-s`);
}
await browser.close(); server.close();
