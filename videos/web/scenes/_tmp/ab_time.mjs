// A/B frame timing: loads two scene pages in one browser and alternates 4-frame bursts at each beat (fair under load)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'), [HITS, A, B, bs, reps] = process.argv.slice(2);
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]); const p = u.endsWith('.meltdown8.hits.json') ? HITS : path.join(ROOT, u); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.json') ? 'application/json' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const pages = [];
for (const name of [A, B]) { const pg = await browser.newPage({ viewport: { width: 1080, height: 1920 } }); pg.setDefaultTimeout(900000);
  await pg.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${name}.html`); await pg.waitForFunction(() => window.sceneReady === true, null, { timeout: 900000 }); pages.push(pg); }
// CPU seconds used by the whole browser tree (swiftshader's GPU process included): wall time on a busy machine is
// inflated by contention; cpu/4 estimates the wall time on an idle 4-core box
const HZ = 100;
function treeCpu(root) { const kids = new Map(), cpu = new Map();
  for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; try { const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'), r = st.slice(st.lastIndexOf(')') + 2).split(' ');
    const pp = +r[1]; if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(+d); cpu.set(+d, (+r[11] + +r[12]) / HZ); } catch (e) {} }
  let sum = 0; const st = [root]; while (st.length) { const p = st.pop(); sum += cpu.get(p) || 0; for (const c of kids.get(p) || []) st.push(c); } return sum; }
const bpid = process.pid;   // the browser tree hangs off this node process
const spb = 0.4, beats = bs.split(',').map(Number), R = Number(reps || 1), tot = [0, 0], ctot = [0, 0];
for (let r = 0; r < R; r++) for (const b of beats) {
  const ms = [], cp = [];
  for (const [i, pg] of pages.entries()) { const el = await pg.$('#out'); let sum = 0;
    const c0 = bpid ? treeCpu(bpid) : 0;
    for (let k = 0; k < 4; k++) { const t = b * spb + k / 30, s0 = Date.now(); await pg.evaluate(t => window.renderFrame(t), t); await el.screenshot({ type: 'jpeg', quality: 90 }); sum += Date.now() - s0; }
    const cpu = bpid ? (treeCpu(bpid) - c0) / 4 : 0; ms.push(sum / 4); cp.push(cpu); tot[i] += sum / 4; ctot[i] += cpu; }
  console.log(`b${b}: ${A} ${(ms[0] / 1000).toFixed(2)} s/frame (cpu ${cp[0].toFixed(2)} s), ${B} ${(ms[1] / 1000).toFixed(2)} s/frame (cpu ${cp[1].toFixed(2)} s), wall ratio ${(ms[1] / ms[0]).toFixed(2)}, cpu ratio ${(cp[1] / cp[0]).toFixed(2)}`);
}
const nb = beats.length * R;
console.log(`mean: ${A} ${(tot[0] / nb / 1000).toFixed(2)} s/frame wall, ${(ctot[0] / nb).toFixed(2)} cpu-s/frame (~${(ctot[0] / nb / 4).toFixed(2)} s on an idle 4-core); ${B} ${(tot[1] / nb / 1000).toFixed(2)} wall, ${(ctot[1] / nb).toFixed(2)} cpu-s (~${(ctot[1] / nb / 4).toFixed(2)} s idle)`);
await browser.close(); server.close();
