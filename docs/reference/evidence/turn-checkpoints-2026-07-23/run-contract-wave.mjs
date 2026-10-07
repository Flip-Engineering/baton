import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Turn-checkpoints contract wave: two spec-drafter seats through baton.waves —
// 31a-contract-drafter (compat spine) and 31b-contract-drafter (steering acts).
// Binding design: docs/35-turn-checkpoints.md (v2, red-teamed). Output style:
// numbered rules with file:line grounding, red-test lists, boundaries, validation.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/turn-checkpoints-2026-07-23';
const evidencePath = resolve(evidenceDir, 'evidence-contracts.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines',
  '(coordinator.mjs/coordination-store.mjs/application.mjs are 5-13k lines) — Grep to locate,',
  'then Read targeted line ranges. Bound every large command output: pipe through tail/grep.',
  'Write large files in chunks. Use FIXED CLOCKS in any test fixture you sketch.',
].join(' ');

const COMMON = [
  'Draft an implementation-grade decisions contract in the style of',
  'docs/reference/evidence/repl-kg-wave-2026-07-22/repl1-decisions.md (numbered rules with',
  'file:line grounding, a red-test list, boundaries, validation). Ground every rule in the',
  'actual code — verify each file:line you cite. The binding design is docs/35-turn-checkpoints.md',
  'v2 — settled; do NOT re-litigate it (card declaration default claim; pausable mints',
  'turn.paused records; paused state with lifecycle parity; steering.registered at run',
  'creation; degenerate auto-settle with basis receipts; nudge/wait/claim acts with own',
  'reservation; visible-only escalation; mid-turn long work is the watchdog\'s domain).',
  'READ-ONLY except your output file; never write scratch files (including /tmp). Do not',
  'invoke nested Baton. One shell command per call. Do not mutate credentials, harness',
  'installations, global configuration, or the main checkout.',
  OVERSIZE,
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: '31a-contract-drafter',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/31a-pause-records-decisions.md`]),
    report: `${relativeRoot}/31a-pause-records-decisions.md`,
    objective: [
      `Write ${relativeRoot}/31a-pause-records-decisions.md — the 31-a contract (issue #31):`,
      'card().turnCompletion declaration with absent-field ⇒ claim default + a card-completeness',
      'lint; turn.paused durable single-consumer records; the paused task state with FULL',
      'lifecycle parity (coordination-store.mjs:115-120 TRANSITIONS, the [working,input_required]',
      'guard sites at coordinator.mjs:9122/:9139/:9199/:9209/:9223/:11473 and',
      'coordination-store.mjs:2879, respond() unpark parity at :8463-8466/:8586-8594);',
      'steering.registered admitted at run creation (waves register by construction — name the',
      'wave.mjs admission seam); degenerate auto-settle with turn.settled {basis} receipts;',
      'replay exactness of all of it. Read docs/35 v2 §2.1/§2.2(4-5) FIRST, then the',
      'turn_completed handler (coordinator.mjs:9880-9913), the interaction family',
      '(:9990-10180), and wave.mjs member admission (:119-156).', COMMON,
    ].join(' '),
  }),
  Object.freeze({
    role: '31b-contract-drafter',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/31b-steering-acts-decisions.md`]),
    report: `${relativeRoot}/31b-steering-acts-decisions.md`,
    objective: [
      `Write ${relativeRoot}/31b-steering-acts-decisions.md — the 31-b contract (issue #31):`,
      'the three steering acts with an explicit single-consumer reservation + authority op',
      '(settle does NOT ride _resolveRecord, coordinator.mjs:8416-8438); nudge as FULL',
      'fresh-turn admission (watchdog re-arm :7421-7429, bumpTurn, budget re-arm — the bare',
      'prompt lane :5990-6098 does none of these); pre-pause scratch-claim invalidation as the',
      '_expireScratchClaims mirror (:10200) with the claimScratch trap named; wait as the',
      'legal zero-cost park; claim (renamed from settle — wave.settle collision) running the',
      'trust gate with pause evidence; turn_checkpoint attention classification with honest',
      'paused projections on RunView (application.mjs:4979-4986 derivation), wave.mjs progress,',
      'story.mjs fold maps; stall-guard parity (:7408). Read docs/35 v2 §2.2(6-8)/§2.3 FIRST,',
      'then fence.mjs:22-49 and the semantic action derivation (application.mjs:8699-8720).',
      COMMON,
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

const log = (line) => console.log(`[tc ${new Date().toISOString()}] ${line}`);
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
  log(`turn-checkpoints contract wave started through baton.waves (${MEMBERS.length} members)`);

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
  const stop = await wave.close({ reason: 'turn-checkpoints contract wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'turn-checkpoints contract driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
