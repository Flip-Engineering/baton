// Determinism test for Timeline scenes (lib/fx/physics_timeline.js):
//   node web/simtest.mjs lab_physics [--per 3] [--times 1.2,5.3] [--bin] [--seed 7]
// Pass A renders the frames in time order in a fresh page and records window.SIM.hash(t) after each
// frame (rigid poses, cloth nodes, crowd positions/velocities, fluid velocity + dye readbacks).
// Pass B renders the same frames out of order in another fresh page: section groups shuffled and each
// group reversed (backward seeks on live sims -> checkpoint restores, cache eviction, section frees, replays). With --bin, pass A then bakes every sim to out/.<scene>.sim.bin
// and pass C loads it in a third fresh page and renders shuffled again (cross-process resume).
// Any hash that differs between passes is printed and the exit code is 1. Also prints the
// Timeline budget report of pass A (steady frames only exist when --per frames are consecutive).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { handleCache } from './cache_server.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2), scene = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const per = Number(opt('per', 3)), seed = Number(opt('seed', 7)), useBin = args.includes('--bin');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  if (handleCache(req, res, ROOT)) return;
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
if (!fs.existsSync(path.join(ROOT, 'out', `.${scene}.hits.json`))) execFileSync('python3', [path.join(ROOT, 'web', 'audio', 'make_audio.py'), scene], { stdio: 'inherit' });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
async function open(noBin) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.setDefaultTimeout(900000);
  page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
  page.on('console', m => { const x = m.text(); if (/BUDGET FAIL|sim\.bin|error/i.test(x)) console.log('[page]', x); });
  if (noBin) await page.addInitScript(() => { window.__noSimBin = true; });
  await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${scene}.html`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 900000 });
  return page;
}
async function pass(page, times, label) {
  const out = {}, t0 = Date.now();
  for (const t of times) {
    const h = await page.evaluate(async t => { await window.renderFrame(t); return window.SIM.hash(t); }, t);
    out[t.toFixed(4)] = h;
    process.stdout.write(`${label} t=${t.toFixed(3)} ${Object.entries(h).map(([k, v]) => k + ':' + v).join(' ')}\n`);
  }
  console.log(`${label}: ${times.length} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return out;
}
// frame list: `per` consecutive frames from the middle of every section that owns sims
let times;
if (opt('times')) times = opt('times').split(',').map(Number);
else {
  const p = await open(true);
  const secs = await p.evaluate(() => window.SIM.sections()), owners = await p.evaluate(() => window.SIM.sims());
  await p.close();
  times = [];
  for (const s of secs) {
    if (s.to - s.from < 0.5) continue;
    const mid = Math.round((s.from + (s.to - s.from) * 0.55) * 30) / 30;
    for (let k = 0; k < per; k++) times.push(Math.round((mid + k / 30) * 30) / 30);
  }
  console.log(`sims: ${owners.join(', ')}`);
}
times.sort((a, b) => a - b);
let r = seed; const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
// out of order: section groups shuffled, frames inside each group reversed, so every section also seeks
// backwards while its sims are live (checkpoint restore + replay), not only after a free
const groups = []; for (const t of times) { const g = groups[groups.length - 1]; if (g && t - g[g.length - 1] < 0.2) g.push(t); else groups.push([t]); }
for (let i = groups.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [groups[i], groups[j]] = [groups[j], groups[i]]; }
const shuffled = groups.flatMap(g => g.slice().reverse());

const pa = await open(true);
const A = await pass(pa, times, 'A in-order');
console.log('budget (pass A):', JSON.stringify(await pa.evaluate(() => window.SIM.budget())));
if (useBin) {
  const t0 = Date.now();
  const bytes = await pa.evaluate(async () => { window.SIM.bake(); return await window.SIM.save(); });
  console.log(`baked + saved out/.${scene}.sim.bin: ${(bytes / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await pa.close();
const pb = await open(true);
const Bh = await pass(pb, shuffled, 'B shuffled');
await pb.close();
let Ch = null;
if (useBin) { const pc = await open(false); const ok = await pc.evaluate(() => window.SIM.loaded()); console.log('pass C sim.bin loaded:', ok); Ch = await pass(pc, shuffled, 'C sim.bin'); await pc.close(); }
let bad = 0;
for (const k of Object.keys(A)) for (const [name, other] of [['B', Bh], ['C', Ch]]) {
  if (!other) continue;
  for (const sim of Object.keys(A[k])) if (A[k][sim] !== other[k][sim]) { bad++; console.log(`MISMATCH t=${k} ${sim}: A=${A[k][sim]} ${name}=${other[k][sim]}`); }
}
const nh = Object.values(A).reduce((a, h) => a + Object.keys(h).length, 0);
console.log(bad ? `NONDETERMINISM: ${bad} mismatched hashes` : `deterministic: ${times.length} frames, ${nh} sim-state hashes, passes A/B${Ch ? '/C' : ''} identical`);
await browser.close(); server.close();
process.exit(bad ? 1 : process.exitCode || 0);
