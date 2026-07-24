import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// #33 implementation wave (contract v2, 6f69c98): ONE opus seat implements the scratchpad
// contract red-first (SP1-SP11 suite, then canonical suite green). Deployment state isolated
// under .baton/scratchpad-impl-2026-07-24 (concurrent controllers may be live elsewhere).
// Driver carries the 31-c steering loop with requestId-keyed nudge dedup (de818e3) plus two
// driver-pattern upgrades from the grammar/scratchpad waves: a PROGRESS-based watchdog
// (any turn-epoch/digest/phase change resets it; 20min stall settles) replacing the flat
// 75-minute timer that killed two healthy workers, and a 3h hard cap.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/scratchpad-2026-07-23';
const evidencePath = resolve(evidenceDir, 'evidence-impl.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/scratchpad-33-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines — Grep',
  'to locate, then Read targeted line ranges. Bound every large command output with',
  'tail/grep. Write large files in chunks.',
].join(' ');

const CLOCK = [
  'FIXED-CLOCK RULE: any test that needs wall-clock control uses the suite fixed-clock',
  'fixture pattern (never real Date.now plus a hardcoded expiry — that time-bombs the suite).',
].join(' ');

const TASK = [
  'Implement issue #33 per the v2 contract at',
  `${relativeRoot}/scratchpad-decisions.md — READ IT IN FULL FIRST (it is controlling,`,
  'including the v2 fold block at the top). Red-first TDD, in this order:',
  '(1) WRITE impl/test/scratchpad-33-red.test.mjs FIRST: the complete SP1-SP11 block per',
  'Part F including the v2 fold rows (R33R-6), every test failing for the right reason before',
  'any implementation exists.',
  '(2) Implement until the focused suite is green: the four store mutators + two snapshot',
  'queries (registered per v2 rule 3 — poison-wrapper allowlist AND injected-store completeness',
  'check), the closed entry grammar + bounds (Part B), event/batch discipline (Part C),',
  'non-evented cached reads with scoped fences (Part D), settle-time elevation with the v2',
  'any-terminal trigger (Part E), horizon + wave projections, the REFLEX-1-family worker',
  'up-channel grammar for scratchpad.write (v2 rule 3 transport), and sanitization via',
  'boundedAttentionText/SECRET_SHAPED_TEXT with provenance marking.',
  '(3) Then run the canonical suite as `node impl/scripts/run-suite.mjs` FROM THE REPO ROOT',
  '(never cd impl first) and keep it fully green.',
  'Work ONLY in your scoped files. One shell command per call. Do not call gh. Do not invoke',
  'nested Baton. When the focused suite AND the canonical suite are both green, end your turn',
  'with work_completed — do not idle waiting for further instruction.',
].join(' ');

// Attempt salt: runs.start is idempotent by objective digest, so every relaunch
// must change the objective or members attach to stopped prior runs.
const ATTEMPT = new Date().toISOString();
const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'scratchpad-implementer-opus',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([
      'impl/test/scratchpad-33-red.test.mjs',
      'impl/src/coordination-store.mjs',
      'impl/src/coordinator.mjs',
      'impl/src/application.mjs',
      'impl/src/adapter.mjs',
      'impl/src/claude-session.mjs',
      'impl/src/kimi-acp.mjs',
      'impl/src/grok-acp.mjs',
      'impl/src/codex-appserver.mjs',
      'impl/src/wave.mjs',
      'impl/src/messages.mjs',
    ]),
    report: 'impl/test/scratchpad-33-red.test.mjs',
    objective: [
      `[attempt: ${ATTEMPT}]`,
      TASK, CLOCK, OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'scratchpad-impl-2026-07-24'),
    routes: [{ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[spimpl ${new Date().toISOString()}] ${line}`);
let failure = null;
let wave = null;
const startedAt = Date.now();
let lastProgressAt = Date.now();
let lastMarker = '';
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
  log(`scratchpad implementation wave started through baton.waves (${MEMBERS.length} members, objectiveBytes=${Buffer.byteLength(MEMBERS[0].objective)})`);

  const terminalRoles = new Set();
  const nudged = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const progress = await wave.progress();
    const line = progress.members.map((entry) => `${entry.role}=${entry.phase}${entry.attention ? `[${JSON.stringify(entry.attention)}]` : ''}`).join(' ');
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line}`);
    const marker = JSON.stringify(progress.members.map((entry) => [entry.role, entry.phase, entry.attention]));
    if (marker !== lastMarker) { lastMarker = marker; lastProgressAt = Date.now(); }
    for (const entry of progress.members) {
      if (entry.phase !== 'paused') continue;
      const run = wave.runs.get(entry.role);
      if (!run) continue;
      try {
        const status = await run.status();
        const view = status?.view ?? status ?? {};
        const checkpoint = (Array.isArray(view.attention) ? view.attention : [])
          .find((item) => item?.kind === 'turn_checkpoint' && typeof item?.requestId === 'string');
        if (checkpoint && !nudged.has(checkpoint.requestId)) {
          await run.act('nudge_turn', { message: 'Continue: red-first tests, then implementation, then the canonical suite — end with work_completed when both are green.' });
          nudged.add(checkpoint.requestId);
          log(`steered nudge_turn on ${checkpoint.requestId} for ${entry.role}`);
        }
      } catch (error) {
        log(`nudge for ${entry.role} returned ${error?.code ?? 'unknown'} (recorded)`);
      }
    }
    for (const entry of progress.members) {
      if (entry.terminal || entry.phase === 'work_completed') terminalRoles.add(entry.role);
    }
    if (Date.now() - lastProgressAt > 20 * 60 * 1000) { log('stalled: no progress marker change in 20min'); break; }
    if (Date.now() - startedAt > 3 * 60 * 60 * 1000) { log('watchdog (3h hard cap)'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'scratchpad implementation wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'scratchpad implementation driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
