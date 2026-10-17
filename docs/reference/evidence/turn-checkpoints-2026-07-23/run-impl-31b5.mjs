import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// 31-b.5 surface-completion wave: ONE sonnet seat through baton.waves — wire the
// turn_checkpoint semantic action (31-b contract rule 16) so a driver can actually
// invoke nudge/wait/claim through run.act. The attention entry exists
// (application.mjs:6821); the acts exist (coordinator.nudgeTurn :2059,
// claimTurn :2171); the registry entries, candidate generation, actionAuthority,
// and act execution do NOT — that is the gap this seat closes.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const contractsRoot = 'docs/reference/evidence/turn-checkpoints-2026-07-23';
const evidencePath = resolve(evidenceDir, 'evidence-impl-31b5.json');
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
    role: '31b5-surface-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/application.mjs', 'impl/src/application-semantics.mjs', 'impl/src/coordinator.mjs',
      'impl/src/mcp-northbound.mjs',
      'impl/test/turn-checkpoints-31b5-surface-red.test.mjs', 'impl/test/phase87-semantic-action-authority.test.mjs',
    ]),
    report: null,
    objective: [
      `Wire the turn_checkpoint semantic action per ${contractsRoot}/31b-steering-acts-decisions.md`,
      'rule 16 (read its lines 167-186 FIRST — the routing decision is made there: the existing',
      'generic semantic-action executor, NO new MCP tool or enum member). The gap: the',
      'turn_checkpoint attention entry exists (application.mjs:6814-6825, requestId = pauseId);',
      'the acts exist (coordinator.nudgeTurn :2059, claimTurn :2171, wait via turn.wait_noted);',
      'but NOTHING registers the action kinds in APPLICATION_SEMANTIC_REGISTRY',
      '(application-semantics.mjs), nothing generates candidates from turn_checkpoint attention',
      'entries in _semanticActions (application.mjs:8761+), and act()/actionAuthority cannot',
      'resolve or execute them. Implement per the contract: registry entries for the steering',
      'acts (nudge with a bounded optional message input, wait, claim — effect/capability',
      'discipline matching the existing answer_* entries); candidate generation from the',
      'turn_checkpoint attention items (target carries pauseId/workerId/taskId/turnEpoch); the',
      'execution path in act() invoking coordinator.nudgeTurn/claimTurn with the validated',
      'inputs (and wait as its receipt act); actionAuthority recheck working through',
      '_recheckSemanticAction like every other kind. Red tests first',
      '(impl/test/turn-checkpoints-31b5-surface-red.test.mjs): action listed on a run with a',
      'pending pause, authority recheck enforced, nudge executes end-to-end through run.act',
      '(task unparks working, watchdogTimer armed), wait receipts without consuming, claim',
      'runs the gate, second act on a resolved record is already_resolved, and',
      'phase87-semantic-action-authority stays green. Then focused green, then the FULL SUITE',
      'green from the worktree root. No git commits, no scratch/log writes anywhere',
      '(including /tmp).',
      OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    routes: [{ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[31b5 ${new Date().toISOString()}] ${line}`);
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
  log(`31-b.5 surface-completion wave started through baton.waves (${MEMBERS.length} members)`);

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
  const stop = await wave.close({ reason: '31-b.5 surface-completion wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: '31-b.5 driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
