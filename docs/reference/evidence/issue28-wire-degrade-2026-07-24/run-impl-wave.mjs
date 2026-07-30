import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Issue #28 implementation wave (contract v2, a35881b): ONE grok seat (first substantive
// seat for grok — bounded adapter scope with the checkpoint-pin safety net) implements
// wire-frame graceful degradation red-first (R28-1..R28-5, then canonical suite green).
// Deployment isolated under .baton/issue28-2026-07-24. Driver: 31-c steering loop +
// requestId dedup + cursor-stripped status-hash stall marker + 20min stall + 3h cap.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/issue28-wire-degrade-2026-07-24';
const evidencePath = resolve(evidenceDir, 'evidence-impl.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/issue28-wire-degrade-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines — Grep',
  'to locate, then Read targeted line ranges. Bound every large command output with',
  'tail/grep. Write large files in chunks. (Yes — this is the exact failure you are fixing.)',
].join(' ');

const CLOCK = [
  'FIXED-CLOCK RULE: any test that needs wall-clock control uses the suite fixed-clock',
  'fixture pattern (never real Date.now plus a hardcoded expiry — that time-bombs the suite).',
].join(' ');

const TASK = [
  'Implement issue #28 per the v2 contract at',
  `${relativeRoot}/issue28-decisions.md — READ IT IN FULL FIRST (it is controlling,`,
  'including the v2 fold block). Red-first TDD, in this order:',
  '(1) WRITE impl/test/issue28-wire-degrade-red.test.mjs FIRST: rows R28-1..R28-5 exactly as',
  'the contract specifies (degrade with receipt; honest kill; configured ceiling + card',
  'read-back; discard-latch idempotence over >2x ceiling multi-write frames; secret',
  'precedence). Use the trigger-driven impl/test/fixtures/fake-claude.mjs pattern — you may',
  'extend that fixture with a BIG_TOOL_RESULT trigger (it is in your scope). Every test must',
  'fail for the right reason before implementation.',
  '(2) Implement until the focused suite is green: the discard latch at BOTH ingestion sites',
  '(completed-line and partial-buffer), the wire.frame_degraded receipt with actor worker',
  'and exact byte counts, the honest-kill path preserved for non-tool_result frames, and the',
  'advanced.adapterOptions.maxWireFrameBytes plumbing (closed-advanced key + validation,',
  'builtInAdapters signature, claude + GLM + kimi family constructors,',
  'card().governance.maxWireFrameBytes read-back). Preserve the secret-check ordering',
  'else-if exactly as it is.',
  '(3) Then run the canonical suite as `node impl/scripts/run-suite.mjs` FROM THE REPO ROOT',
  '(never cd impl first) and keep it fully green.',
  'Work ONLY in your scoped files. One shell command per call. Do not call gh. Do not invoke',
  'nested Baton. When the focused suite AND the canonical suite are both green, end your turn',
  'with work_completed — do not idle waiting for further instruction.',
].join(' ');

const ATTEMPT = new Date().toISOString();
const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'wire-degrade-implementer-grok',
    exact: Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'high' }),
    scope: Object.freeze([
      'impl/test/issue28-wire-degrade-red.test.mjs',
      'impl/test/fixtures/fake-claude.mjs',
      'impl/src/claude-session.mjs',
      'impl/src/application-deployment.mjs',
    ]),
    report: 'impl/test/issue28-wire-degrade-red.test.mjs',
    objective: [
      `[attempt: ${ATTEMPT}]`,
      TASK, CLOCK, OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'issue28-2026-07-24'),
    routes: [{ harness: 'grok', model: 'grok-4.5', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[i28 ${new Date().toISOString()}] ${line}`);
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
  log(`issue28 implementation wave started through baton.waves (${MEMBERS.length} members, objectiveBytes=${Buffer.byteLength(MEMBERS[0].objective)})`);

  const terminalRoles = new Set();
  const nudged = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const progress = await wave.progress();
    const line = progress.members.map((entry) => `${entry.role}=${entry.phase}${entry.attention ? `[${JSON.stringify(entry.attention)}]` : ''}`).join(' ');
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line}`);
    const markerParts = [];
    for (const entry of progress.members) {
      if (entry.terminal) { markerParts.push([entry.role, 'terminal']); continue; }
      const run = wave.runs.get(entry.role);
      let digest = 'unavailable';
      try {
        const status = run ? await run.status() : null;
        const view = { ...(status?.view ?? status ?? {}) };
        delete view.cursor;
        digest = createHash('sha256').update(JSON.stringify(view)).digest('hex').slice(0, 16);
      } catch { /* transient */ }
      markerParts.push([entry.role, entry.phase, digest]);
    }
    const marker = JSON.stringify(markerParts);
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
          await run.act('nudge_turn', { message: 'Continue: red-first R28 suite, then implementation, then the canonical suite — end with work_completed when both are green.' });
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
    if (Date.now() - lastProgressAt > 20 * 60 * 1000) { log('stalled: no status-view change in 20min'); break; }
    if (Date.now() - startedAt > 3 * 60 * 60 * 1000) { log('watchdog (3h hard cap)'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'issue28 implementation wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'issue28 implementation driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
