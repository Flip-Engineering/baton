// Whole-frame benchmark: median ms per frame at chosen beats (renderFrame alone, and + the JPEG screenshot
// render.mjs takes). Warm: one frame is rendered before timing each beat.
//   node tools/type_bench.mjs <scene> <beat,beat,...> [--n 5] [--q '?blur=0']
import fs from 'node:fs';
import { openScene, loadavg } from './_page.mjs';
// CPU time (user+sys, ms) of every process under this node process (the Chromium tree). On a shared box the
// wall clock is inflated by run-queue waits; CPU time is what the frame costs, i.e. the idle-box estimate
// (an upper bound when SwiftShader spreads a frame over several threads).
const TCK = 10;   // ms per clock tick (USER_HZ = 100)
function cpuMs() {
  const kids = new Map();
  for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue;
    try { const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'); const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
      kids.set(+d, { pp: +f[1], cpu: (+f[11] + +f[12]) * TCK }); } catch {} }
  let sum = 0; const want = new Set([process.pid]); let grew = true;
  while (grew) { grew = false; for (const [pid, k] of kids) if (!want.has(pid) && want.has(k.pp)) { want.add(pid); grew = true; } }
  for (const pid of want) if (pid !== process.pid && kids.has(pid)) sum += kids.get(pid).cpu;
  return sum;
}
const args = process.argv.slice(2), scene = args[0], beats = args[1].split(',').map(Number);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const n = Number(opt('n', 5)), q = opt('q', '');
const la0 = loadavg();
const S = await openScene(scene, q);
const spb = 60 / S.hits.bpm, canvas = await S.page.$('#out');
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
console.log(`${scene}${q} ready in ${S.loadMs} ms (load ${la0})`);
const rows = [];
for (const b of beats) {
  const t0 = b * spb;
  await S.page.evaluate(t => window.renderFrame(t), Math.max(0, t0 - 1 / 30));
  const r = [], f = [], c = [];
  for (let k = 0; k < n; k++) {
    const s = Date.now(), c0 = cpuMs();
    await S.page.evaluate(t => window.renderFrame(t), t0 + k / 30);
    r.push(Date.now() - s);
    await canvas.screenshot({ type: 'jpeg', quality: 93 });
    f.push(Date.now() - s); c.push(cpuMs() - c0);
  }
  rows.push([b, med(r), med(f), med(c)]);
  console.log(`beat ${b.toFixed(2).padStart(6)}  wall: render ${String(med(r)).padStart(5)}  +jpeg ${String(med(f)).padStart(5)} ms   cpu +jpeg ${String(med(c)).padStart(5)} ms   (load ${loadavg()})`);
}
const mean = k => (rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(0);
console.log(`mean wall +jpeg ${mean(2)} ms/frame (max ${Math.max(...rows.map(r => r[2]))}); mean cpu +jpeg ${mean(3)} ms/frame (max ${Math.max(...rows.map(r => r[3]))})`);
await S.close();
