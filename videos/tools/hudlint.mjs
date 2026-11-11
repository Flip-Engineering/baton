// HUD readout: what each counter / split-flap / terminal is doing on every impact beat (and on the listed still beats),
// for a person to look at. A counter usually lands on the hit; one still rolling there may be a slip or a choice.
//   node tools/hudlint.mjs <scene> [--beats 2,5,...] [--hits impact,gong] [--log logs/<scene>_stills.log]
// Scenes opt in with window.hudState() -> { beat, items: [{ kind, role, moving, text }] } (lib/fx/hud.js hudBegin/hudState)
// and by logging `hud beat=<b> [[kind, role, moving, text], ...]` per frame (the stills log is parsed, not re-rendered).
// Impact beats missing from the log are rendered here. It always exits 0: it reports, it does not judge.
import fs from 'node:fs'; import path from 'node:path';
import { openScene, ROOT } from './_page.mjs';
const args = process.argv.slice(2), scene = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const hitNames = opt('hits', 'impact').split(','), logf = opt('log', path.join(ROOT, 'logs', `${scene}_stills.log`));
const hits = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', `.${scene}.hits.json`))), spb = 60 / hits.bpm;
const impact = [...new Set(hitNames.flatMap(n => (hits.hits[n] || []).map(t => Math.round(t / spb * 100) / 100)))].sort((a, b) => a - b);
const MOVERS = new Set(['odometer', 'splitflap', 'terminal']);
const seen = {};
if (fs.existsSync(logf)) for (const L of fs.readFileSync(logf, 'utf8').split('\n')) {
  const m = L.match(/hud beat=([\d.]+) (\[.*\])\s*$/); if (!m) continue;
  seen[Math.round(+m[1] * 100) / 100] = JSON.parse(m[2]).map(([kind, role, moving, text]) => ({ kind, role, moving: !!moving, text }));
}
const need = impact.filter(b => !seen[b]);
if (need.length) {
  const S = await openScene(scene);
  const has = await S.page.evaluate(() => typeof window.hudState === 'function');
  if (!has && !Object.keys(seen).length) { console.log(`hudlint ${scene}: SKIP (no window.hudState)`); await S.close(); process.exit(0); }
  for (const b of need) { await S.page.evaluate(t => window.renderFrame(t), b * spb); seen[b] = (await S.page.evaluate(() => window.hudState()))?.items || []; }
  await S.close();
}
let moving = 0; const out = [];
const check = (b, items, isImpact) => {
  const mv = items.filter(h => MOVERS.has(h.kind) && h.moving);
  const tag = isImpact ? 'impact' : 'still ';
  if (mv.length) { out.push(`${tag} beat ${b}: still moving ${mv.map(h => `${h.kind} "${h.text}"`).join(', ')}`); if (isImpact) moving++; }
  else out.push(`${tag} beat ${b}: landed ${items.filter(h => MOVERS.has(h.kind)).map(h => `${h.kind} "${h.text}"`).join(', ') || '-'}`);
};
for (const b of impact) check(b, seen[b], true);
for (const b of (opt('beats', '') ? opt('beats').split(',').map(Number) : [])) { const k = Math.round(b * 100) / 100; if (seen[k] && !impact.includes(k)) check(k, seen[k], false); }
console.log(out.join('\n'));
console.log(`hudlint ${scene}: impact beats ${impact.join(' ')} (${hitNames.join('+')}); ${moving} with a counter/flap/terminal still moving, to look at`);
process.exit(0);
