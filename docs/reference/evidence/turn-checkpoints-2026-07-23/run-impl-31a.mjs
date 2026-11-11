import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// 31-a implementation wave: ONE opus seat through baton.waves — the turn-checkpoints
// compatibility spine (card declarations, turn.paused records, paused state lifecycle,
// runs.start marker machinery WITHOUT the wave.mjs:151 driverKind edit — deferred to
// 31-b per the v2 contract). Binding contract (v2 FINAL, 3701a35):
//   docs/reference/evidence/turn-checkpoints-2026-07-23/31a-pause-records-decisions.md

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const contractsRoot = 'docs/reference/evidence/turn-checkpoints-2026-07-23';
const evidencePath = resolve(evidenceDir, 'evidence-impl-31a.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines',
  '(coordinator.mjs/coordination-store.mjs/application.mjs are 5-13k lines) — Grep to locate,',
  'then Read targeted line ranges. Bound every large command output: pipe through tail/grep',
  '(e.g. `node scripts/run-suite.mjs 2>&1 | tail -60`). Write large files in chunks. Use',
  'FIXED CLOCKS in every test fixture (a worker-authored time-bomb already shipped once).',
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: '31a-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/coordinator.mjs', 'impl/src/coordination-store.mjs', 'impl/src/application.mjs',
      'impl/src/adapter.mjs', 'impl/src/claude-session.mjs', 'impl/src/codex-appserver.mjs',
      'impl/src/grok-acp.mjs', 'impl/src/kimi-acp.mjs', 'impl/src/story.mjs',
      'impl/src/mcp-northbound.mjs', 'impl/src/application-cli.mjs',
      'impl/test/turn-checkpoints-31a-red.test.mjs', 'impl/test/card-completeness-lint-red.test.mjs',
    ]),
    report: null,
    objective: [
      `Implement issue #31 slice A per ${contractsRoot}/31a-pause-records-decisions.md — read`,
      'it FIRST; it is your binding contract (v2 FINAL): card().turnCompletion declaration with',
      'absent-field ⇒ claim default + the card-completeness lint on the five production cards;',
      'turn.paused durable single-consumer records with the pause:${task.id}:${seq} key space;',
      'the paused task state with FULL lifecycle parity (TRANSITIONS, the named guard sites,',
      'respond() unpark parity, coordination-store.mjs:10630/:10637 mappings, story.mjs',
      'TURN_PAUSED with from [working, idle]); the runs.start marker machinery — normalizeIntent',
      'whitelist (:919-921) + pass-through (:933-941) with the digest/existing-run cases the',
      'contract pins — admitted with NO caller in this slice; degenerate auto-settle with',
      'turn.settled {basis} receipts via the single existing gated dispatch (settled-return',
      'pattern); CI6 restart semantics as chosen in the contract; baseSha-absent ⇒',
      'canonicalDigest([]). CRITICAL ORDERING: do NOT edit wave.mjs (the driverKind wave edit',
      'is deferred to 31-b by contract). Red tests first',
      '(impl/test/turn-checkpoints-31a-red.test.mjs AND impl/test/card-completeness-lint-red.test.mjs),',
      'then implementation, then focused green, then the FULL SUITE green from the worktree',
      'root — the entire existing suite MUST stay green unchanged (this is the compat spine).',
      'No git commits, no scratch/log writes anywhere (including /tmp).',
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

const log = (line) => console.log(`[31a ${new Date().toISOString()}] ${line}`);
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
  log(`31-a implementation wave started through baton.waves (${MEMBERS.length} members)`);

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
  const stop = await wave.close({ reason: '31-a implementation wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: '31-a driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
