import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Issue #53 implementation wave (contract v2, c9e2b1d): ONE sonnet seat implements the
// operator debug surface red-first (R53-1..R53-6, then canonical suite green).
// Deployment isolated under .baton/issue53-2026-07-24. Driver: 31-c steering loop +
// requestId dedup + cursor-stripped status-hash stall marker + 20min stall + 3h cap.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/issue53-run-debug-2026-07-24';
const evidencePath = resolve(evidenceDir, 'evidence-impl.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/issue53-run-debug-red.test.mjs'],
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
  'Implement issue #53 per the v2 contract at',
  `${relativeRoot}/issue53-decisions.md — READ IT IN FULL FIRST (it is controlling,`,
  'including the v2 fold block). Red-first TDD, in this order:',
  '(1) WRITE impl/test/issue53-run-debug-red.test.mjs FIRST: rows R53-1..R53-6 exactly as',
  'the contract specifies (message accessor; write receipts with code=result; failure-cause',
  'derivation table; JSON-key ban list with stale_fence surviving as a value; CLI parity;',
  'boundedAttentionText redaction). Fixtures inject content.message and scratchpad.write',
  'through adapter.emit (the reflex1 pattern) — never via the store directly. Every test',
  'must fail for the right reason before implementation.',
  '(2) Implement until the focused suite is green: the embedded run.debug({member,limit})',
  'accessor (direct per-worker stream reads scoped by the run snapshot member set; whitelist',
  'projections; boundedAttentionText applied by the accessor itself, never raw output',
  'frames), the observe-capability command registration authorized like run.inspect, the',
  'baton run debug CLI verb (registration order matters — the parseStart fallback eats',
  'unrecognized verbs), and the client method beside events()/output().',
  '(3) Then run the canonical suite as `node impl/scripts/run-suite.mjs` FROM THE REPO ROOT',
  '(never cd impl first) and keep it fully green.',
  'Work ONLY in your scoped files. One shell command per call. Do not call gh. Do not invoke',
  'nested Baton. When the focused suite AND the canonical suite are both green, end your turn',
  'with work_completed — do not idle waiting for further instruction.',
  'Work ONLY in your scoped files. One shell command per call. Do not call gh. Do not invoke',
  'nested Baton. When the focused suite AND the canonical suite are both green, end your turn',
  'with work_completed — do not idle waiting for further instruction.',
].join(' ');

const ATTEMPT = new Date().toISOString();
const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'run-debug-implementer-sonnet',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([
      'impl/test/issue53-run-debug-red.test.mjs',
      'impl/src/application.mjs',
      'impl/src/application-client.mjs',
      'impl/src/application-cli.mjs',
      'impl/src/coordinator.mjs',
    ]),
    report: 'impl/test/issue53-run-debug-red.test.mjs',
    objective: [
      `[attempt: ${ATTEMPT}]`,
      TASK, CLOCK, OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'issue53-2026-07-24'),
    routes: [{ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[i53 ${new Date().toISOString()}] ${line}`);
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
  log(`issue53 implementation wave started through baton.waves (${MEMBERS.length} members, objectiveBytes=${Buffer.byteLength(MEMBERS[0].objective)})`);

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
  const stop = await wave.close({ reason: 'issue53 implementation wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'issue53 implementation driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
