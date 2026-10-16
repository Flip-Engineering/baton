import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// 31-b implementation wave: ONE opus seat through baton.waves — the steering acts
// (nudge/wait/claim) with the wave.mjs driverKind edit this slice unblocks, attention
// classification, and projections. Binding contract (v2 FINAL, 3701a35):
//   docs/reference/evidence/turn-checkpoints-2026-07-23/31b-steering-acts-decisions.md
// 31-a compat spine is LANDED (4160e72, suite 2744/2744) — its cross-contract
// dependencies (coordination-store.mjs:10630 paused mapping etc.) are present.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const contractsRoot = 'docs/reference/evidence/turn-checkpoints-2026-07-23';
const evidencePath = resolve(evidenceDir, 'evidence-impl-31b.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines — Grep',
  'to locate, then Read targeted line ranges. Bound every large command output with',
  'tail/grep. Write large files in chunks. Use FIXED CLOCKS in every test fixture.',
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: '31b-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/coordinator.mjs', 'impl/src/coordination-store.mjs', 'impl/src/application.mjs',
      'impl/src/wave.mjs', 'impl/src/story.mjs', 'impl/src/mcp-northbound.mjs',
      'impl/src/application-cli.mjs', 'impl/src/fence.mjs',
      'impl/test/turn-checkpoints-31b-red.test.mjs', 'impl/test/wave-driver-red.test.mjs',
    ]),
    report: null,
    objective: [
      `Implement issue #31 slice B per ${contractsRoot}/31b-steering-acts-decisions.md — read`,
      'it FIRST; it is your binding contract (v2 FINAL). The 31-a compat spine is LANDED',
      '(4160e72; coordination-store.mjs:10630/:10637 paused mappings are present — verify,',
      'do not duplicate). Implement: the three steering acts with an explicit single-consumer',
      'reservation + authority op (settle does NOT ride _resolveRecord); nudge as the FULL',
      'fresh-turn admission sequence the contract enumerates (reserve → provider-turn',
      'admission + event queue → delivery → claim invalidation → bump → task/handle status',
      'to working with _coordTransition parity → clearBudgetStop/resetWatchdog → turn_started',
      'append carrying pauseId → drain queue); wait as turn.wait_noted receipt that NEVER',
      'consumes the record (stays pending, all later acts legal); claim RE-RUNNING the live',
      'capture at claim time (gate unchanged in content; changedPathsDigest is attention-only);',
      'scratch-only fence-filtered claim expiry AFTER successful admission; the wave.mjs:151',
      'driverKind edit (this slice unblocks it); turn_checkpoint attention classification with',
      'honest paused projections (all three phase ternaries) and MCP/CLI surfaces; stall-guard',
      'parity. Red tests first (impl/test/turn-checkpoints-31b-red.test.mjs) asserting',
      'handle.watchdogTimer != null and handle/task status working — never generation-only.',
      'Then focused green, then the FULL SUITE green from the worktree root. No git commits,',
      'no scratch/log writes anywhere (including /tmp).',
      OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    routes: [{ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[31b ${new Date().toISOString()}] ${line}`);
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
  log(`31-b implementation wave started through baton.waves (${MEMBERS.length} members)`);

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
  const stop = await wave.close({ reason: '31-b implementation wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: '31-b driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
