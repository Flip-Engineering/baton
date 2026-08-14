#!/bin/bash
# v21 fleet watcher — settles for the 12 re-driven waves (TARGET=12). Prints each
# wave.settled verdict + per-member outcome on arrival; exits when all 12 settle.
cd /Users/wahargis/Development/Experiments/baton
node << 'EOF'
const fs = require('fs');
const L = '.git/baton/application-v3/state/coordination/events.jsonl';
const BOOT = new Date().toISOString().slice(0, 16); // minute-resolution boot marker
const KEYS = new Set([
  'impl-honesty-2026-08-14-wave-h', 'lifecycle-contracts-2026-08-14-wave-a-rd6',
  'impl-telemetry-2026-08-14-wave-e', 'eval-r0-2026-08-14-wave-d',
  'impl-plan-object-2026-08-14-wave-d', 'impl-result-accessor-2026-08-14-wave-d',
  'readme-split-2026-08-14-wave-d', 'lch-contracts-2026-08-14-wave-b-rd4',
  'impl-gate-digest-2026-08-14-wave-d', 'audit-147-rerun-2026-08-14-wave-c',
  'contract-seeds-2026-08-14-wave-c', 'phase-grammar-2026-08-14-wave-a-rd6',
]);
const seen = new Set();
const TARGET = 12;
const poll = () => {
  try {
    for (const l of fs.readFileSync(L, 'utf8').trim().split('\n')) {
      try {
        const e = JSON.parse(l); const p = e.payload ?? {};
        if (p.kind === 'wave.started' && KEYS.has(p.idempotencyKey)) seen.add(p.waveId);
        if (p.kind === 'wave.settled' && seen.has(p.waveId) && !done.has(p.waveId)) {
          done.add(p.waveId);
          const r = p.receipt ?? {};
          const bad = (r.outcomes ?? []).filter((o) => o.phase === 'failed' || o.phase === 'stopped')
            .map((o) => `${o.role}:${o.phase}${o.terminalCause ? '(' + o.terminalCause + ')' : ''}`);
          const ok = (r.outcomes ?? []).filter((o) => o.phase !== 'failed').length;
          console.log(new Date().toISOString().slice(11, 19), r.verdict, p.waveId.slice(5, 17),
            '| ok:' + ok, bad.length ? 'bad:' + bad.join(',') : 'bad:none');
          if (done.size >= TARGET) { console.log('[watcher-v21] ALL 12 SETTLED'); process.exit(0); }
        }
      } catch {}
    }
  } catch {}
  setTimeout(poll, 5000);
};
const done = new Set();
console.log('[watcher-v21] armed at', BOOT, '— waiting for', TARGET, 'settles');
poll();
EOF
