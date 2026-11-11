import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// KG implementation wave B: two seats through baton.waves —
// kg12-implementer (horizon projections + promotion paths, sonnet) and
// kg34-implementer (activation + graph growth/quality, opus).
// Binding contracts (v2 FINAL, 7dd5bb6):
//   docs/reference/evidence/repl-kg-wave-2026-07-22/kg12-decisions.md
//   docs/reference/evidence/repl-kg-wave-2026-07-22/kg34-decisions.md
// REPL-1..3 are landed (bindings + bindingFence exist), satisfying kg12's
// stated sequencing dependency. Overlap: both seats share coordination-store.mjs
// and coordinator.mjs — extraction is sequential with 3-way apply if hunks collide.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const contractsRoot = 'docs/reference/evidence/repl-kg-wave-2026-07-22';
const evidencePath = resolve(evidenceDir, 'evidence-impl-b.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines',
  '(coordination-store.mjs/coordinator.mjs/application.mjs are 5-13k lines) — Grep to locate,',
  'then Read targeted line ranges. Bound every large command output: pipe through tail/grep',
  '(e.g. `node scripts/run-suite.mjs 2>&1 | tail -60`). Write large files in chunks.',
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'kg12-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/coordination-store.mjs', 'impl/src/coordinator.mjs', 'impl/src/application.mjs',
      'impl/test/kg12-decisions-red.test.mjs',
    ]),
    report: null,
    objective: [
      `Implement KG-1 + KG-2 per ${contractsRoot}/kg12-decisions.md — read it FIRST; it is`,
      'your binding contract (v2 FINAL): three horizon projections with union-fence caching',
      '(INCLUDING the store-wide components — knowledge.*/package.* event counts — so no write',
      'outside the named fences can stale-hit) and non-evented task/workflow reads; board-close',
      '-> workflow Finding (grounding observed, coordinationSeq evidence, extras triple);',
      'Source-node idempotent minting + DerivedFrom citation bridging for packages; settle-time',
      'orchestrator-admit gate (wrapper-bound actor, prospective-seq discipline). REPL-2',
      'bindingFence EXISTS in this tree (coordination-store.mjs bindingFence) — the sequencing',
      'dependency is satisfied. Red tests first (impl/test/kg12-decisions-red.test.mjs), then',
      'implementation, then focused green, then the full suite green from the worktree root.',
      'No git commits, no scratch/log writes anywhere (including /tmp).',
      OVERSIZE,
    ].join(' '),
  }),
  Object.freeze({
    role: 'kg34-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/coordination-store.mjs', 'impl/src/coordinator.mjs', 'impl/src/application.mjs',
      'impl/src/messages.mjs',
      'impl/test/kg3-activation-red.test.mjs', 'impl/test/kg4-quality-red.test.mjs',
    ]),
    report: null,
    objective: [
      `Implement KG-3 + KG-4 per ${contractsRoot}/kg34-decisions.md — read it FIRST; it is`,
      'your binding contract (v2 FINAL): recallPreview (non-evented, cached to the',
      'project-horizon fence, exact-keys internal query shape, policy SPLIT — exact-11-field',
      'recall sub-object plus separately-validated preview extras, fail-open with',
      'briefingUnavailable incl. the degradable stale-seed class, never feeds recall',
      'assessment); the REAL injection seams (:2814 spawn opts wrapper + :4554-4555 prompt',
      'render, NEVER :4784, briefDigest untouched); sanitizer relocated to messages.mjs or a',
      'shared hygiene module (it is private in application.mjs today); decision-time',
      'related-nodes; contradiction-first ranking with contradiction-peel before degrade;',
      'auto-link restricted to Supports/Refines/Cites with per-type thresholds and a',
      'deterministic idempotency key (edges carry NO grounding — briefing provenance instead);',
      'MAD confidence with the oracle vendored INLINE in the contract (linear-time extraction,',
      'NaN/Infinity guards). Red tests first (impl/test/kg3-activation-red.test.mjs AND',
      'impl/test/kg4-quality-red.test.mjs), then implementation, then focused green, then the',
      'full suite green from the worktree root. No git commits, no scratch/log writes anywhere',
      '(including /tmp).',
      OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    routes: [
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
      { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' },
    ],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[implB ${new Date().toISOString()}] ${line}`);
let failure = null;
let wave = null;
const startedAt = Date.now();
try {
  const readiness = await baton.doctor();
  for (const member of MEMBERS) {
    const ready = readiness.routes.find((candidate) => (
      candidate.harness === member.exact.harness && candidate.model === member.exact.model && candidate.effort === member.exact.effort
    ));
    if (ready?.state !== 'ready') {
      throw Object.assign(new Error(ready?.summary ?? `${member.role} route unavailable`), { code: ready?.code ?? 'route_unavailable' });
    }
  }
  wave = await baton.waves.start({
    repoRoot: repo,
    members: MEMBERS.map(({ role, exact, scope, report, objective }) => ({ role, exact, scope: [...scope], report, objective })),
  });
  log(`KG implementation wave B started through baton.waves (${MEMBERS.length} members)`);

  const terminalRoles = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const progress = await wave.progress();
    const line = progress.members.map((entry) => `${entry.role}=${entry.phase}${entry.attention ? `[${entry.attention}]` : ''}`).join(' ');
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line}`);
    for (const entry of progress.members) {
      if (entry.terminal || entry.phase === 'work_completed') terminalRoles.add(entry.role);
    }
    if (Date.now() - startedAt > 100 * 60 * 1000) { log('watchdog'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'KG implementation wave B settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'implementation wave B driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
