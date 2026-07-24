import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Issue #45 implementation wave (contract v2, 94c4a12): ONE codex seat implements startup
// reconciliation self-heal red-first (R45-1..7 suite, then canonical suite green).
// Deployment state isolated under .baton/issue45-2026-07-24. Driver: 31-c steering loop with
// requestId-keyed nudge dedup (de818e3) + status-hash stall marker (issue #46 misfire lesson —
// wave-level phase/attention is static during a long productive turn, so the marker hashes each
// member's run.status() view; a stall means NO view change at all), 20min stall, 3h hard cap.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/issue45-reconcile-2026-07-24';
const evidencePath = resolve(evidenceDir, 'evidence-impl.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/issue45-startup-reconcile-red.test.mjs'],
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
  'Implement issue #45 per the v2 contract at',
  `${relativeRoot}/issue45-decisions.md — READ IT IN FULL FIRST (it is controlling,`,
  'including the v2 fold block). Red-first TDD, in this order:',
  '(1) WRITE impl/test/issue45-startup-reconcile-red.test.mjs FIRST: rows R45-1 through R45-7',
  'exactly as the contract specifies (proof-complete self-heal with a live-controller record',
  'beside it; all three receipt states allocated/ready/stopped; the enumerated refusal set',
  'with named subjects + remedy + error.cause.report; the R45R-2 dead_foreign_checkout shape;',
  'scoped idempotence), every test failing for the right reason before implementation.',
  '(2) Implement until the focused suite is green: reconcile-time release without the',
  'allocated-state gate AT THE RECONCILE CALL SITE ONLY (publication paths untouched), the',
  'enumerated diagnostics-to-refusal promotion (expected-owner retentions and the proceed set',
  'never throw), the named-subjects + remedy message composition (diagnostics retained:true',
  'PLUS report.errors ids), error.cause attached at BOTH _trackStartupCleanup swallow sites,',
  'the facade log forwarding at index.mjs:960-968 so the reconciled events actually fire, and',
  'the worktree.owner_residue_reconciled sibling event with the pinned payload.',
  '(3) Then run the canonical suite as `node impl/scripts/run-suite.mjs` FROM THE REPO ROOT',
  '(never cd impl first) and keep it fully green — phase92.2 physical-workspace-owner tests',
  'and issue5 cross-controller lifecycle recovery MUST stay green byte-identically.',
  'Work ONLY in your scoped files. One shell command per call. Do not call gh. Do not invoke',
  'nested Baton. When the focused suite AND the canonical suite are both green, end your turn',
  'with work_completed — do not idle waiting for further instruction.',
].join(' ');

// Attempt salt: runs.start is idempotent by objective digest, so every relaunch
// must change the objective or members attach to stopped prior runs.
const ATTEMPT = new Date().toISOString();
const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'issue45-implementer-codex',
    exact: Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }),
    scope: Object.freeze([
      'impl/test/issue45-startup-reconcile-red.test.mjs',
      'impl/src/worktree.mjs',
      'impl/src/coordinator.mjs',
      'impl/src/index.mjs',
    ]),
    report: 'impl/test/issue45-startup-reconcile-red.test.mjs',
    objective: [
      `[attempt: ${ATTEMPT}]`,
      TASK, CLOCK, OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'issue45-2026-07-24'),
    routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[i45 ${new Date().toISOString()}] ${line}`);
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
  log(`issue45 implementation wave started through baton.waves (${MEMBERS.length} members, objectiveBytes=${Buffer.byteLength(MEMBERS[0].objective)})`);

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
        const view = status?.view ?? status ?? {};
        digest = createHash('sha256').update(JSON.stringify(view)).digest('hex').slice(0, 16);
      } catch { /* transient status failure is not a stall signal */ }
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
          await run.act('nudge_turn', { message: 'Continue: red-first R45 suite, then implementation, then the canonical suite — end with work_completed when both are green.' });
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
  const stop = await wave.close({ reason: 'issue45 implementation wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'issue45 implementation driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
