#!/usr/bin/env node
// DEAD LABOUR's ledger for the score (v2, 15 Oct 2026). The scene's own sources (the city's Skyline built here without a renderer, the same
// rows and seed as scenes/deadlabour.world.js, sampled by deadlabour.plan.js sampleSources) and the plan's flows (deadlabour.plan.js FLOWS:
// the deposit's own arrivals, no hours) through lib/fx/siphon.js SiphonLedger: the same curves the picture draws, written to
// web/assets/deadlabour/ledger.json for the score (one ledger curve drives both picture and sound).
//   node videos/tools/deadlabour_ledger.mjs [--check]     (--check: build and verify, write nothing)
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Skyline } from '../web/lib/fx/americana_city.js';
import { SiphonLedger } from '../web/lib/fx/siphon.js';
import { SKY_ROWS, SKY_SEED, RINGS, DEP, TL, sampleSources, flowsFor, train } from '../web/scenes/deadlabour.plan.js';

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'web');
const sky = new Skyline({ scene: new THREE.Scene() }, { add: L => L }, SKY_ROWS, { seed: SKY_SEED });
const SRC = sampleSources(sky.rows.flatMap(r => r.tiers), RINGS);
const L = new SiphonLedger({ yK: 0 });
L.sink('body', { p: [0, (DEP.CROWN[0] + DEP.CROWN[1]) / 2, DEP.ZC], r: 50 });
for (const s of SRC) L.source(s);
for (const f of flowsFor()) L.flow(f);
L.train(train()).build();

const HZ = 50, N = Math.round(TL.end * HZ) + 1, r4 = x => Math.round(x * 1e4) / 1e4;
const t = Array.from({ length: N }, (_, k) => k / HZ);
let worst = 0; const out = { note: 'written by tools/deadlabour_ledger.mjs from deadlabour.plan.js FLOWS and the scene\'s own sources; read by the score', hz: HZ,
  sources: SRC.length, rings: Object.fromEntries(RINGS.map(g => [g.group, SRC.filter(s => s.group === g.group).length])), body: [], home: [], near: [], inflight: [], arrivals: {}, train: train() };
const NEAR = SRC.map((s, i) => s.group === 'r1' ? i : -1).filter(i => i >= 0);
for (const x of t) {
  const g = L.ledger(x); worst = Math.max(worst, Math.abs(g.total - L.W));
  out.body.push(r4(L.held('body', x) / L.cap('body')));
  out.home.push(r4(g.atSources / L.W));
  out.near.push(r4(NEAR.reduce((a, i) => a + L.left(i, x), 0) / NEAR.length));
  out.inflight.push(r4(g.inFlight / L.W));
}
for (const a of L.arrivals(-1, TL.end)) { const k = a.dir > 0 ? 'drain' : 'return'; (out.arrivals[k] ||= {}); const b = a.t.toFixed(2); out.arrivals[k][b] = (out.arrivals[k][b] || 0) + 1; }
out.total = r4(L.W); out.worst = worst;
if (worst > 1e-9 * L.W) { console.error(`deadlabour_ledger: the ledger leaked ${worst}`); process.exit(1); }
const b = s => out.body[Math.round(s * HZ)];
console.log(`deadlabour_ledger: ${SRC.length} sources (${Object.entries(out.rings).map(([k, v]) => `${k} ${v}`).join(', ')}); total ${out.total}, worst ${worst.toExponential(1)}; body ${[0, 8.6, 21.6, 30.4, 36, 41].map(s => `${s}:${b(s)}`).join(' ')}`);
if (!process.argv.includes('--check')) { fs.writeFileSync(path.join(WEB, 'assets/deadlabour/ledger.json'), JSON.stringify(out)); console.log('wrote web/assets/deadlabour/ledger.json'); }
