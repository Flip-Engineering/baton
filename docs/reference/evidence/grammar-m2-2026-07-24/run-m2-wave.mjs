import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Grammar M2 wave (docs/36-unified-control-grammar.md section 9 M2, issue #43): ONE codex seat
// through baton.waves - the vocabulary flip. Driver skeleton: the issue-45 converged pattern
// (status-hash stall marker per issue #46, requestId-keyed nudges, 20min stall / 3h cap),
// detached under launchd by the launcher.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidencePath = resolve(evidenceDir, 'evidence-m2.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/grammar-m2-red.test.mjs', 'impl/test/surface-conformance-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize, issue #28): a single stream-json frame over 8MiB',
  'kills your run. NEVER Read a whole file over ~1500 lines - Grep to locate, then Read',
  'targeted ranges. Bound every large command output with tail/grep. Write large files in',
  'chunks. FIXED CLOCKS in every fixture (the clock lint enforces this).',
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'grammar-m2-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/application-semantics.mjs',
      'impl/src/application.mjs',
      'impl/src/application-client.mjs',
      'impl/src/application-cli.mjs',
      'impl/src/wave.mjs',
      'impl/src/story.mjs',
      'impl/src/mcp-northbound.mjs',
      'impl/scripts/surface-conformance.mjs',
      'impl/scripts/surface-divergence-ledger.json',
      'impl/scripts/surface-audit.mjs',
      'impl/test/grammar-m2-red.test.mjs',
      'impl/test/grammar-m1-red.test.mjs',
      'impl/test/surface-conformance-red.test.mjs',
      'impl/test/phase67-run-terminality.test.mjs',
      'impl/test/wave-driver-red.test.mjs',
    ]),
    report: null,
    objective: [
      'Implement grammar phase M2 - the vocabulary flip - per',
      'docs/36-unified-control-grammar.md (READ IT FIRST: sections 7.1/7.2/7.3 with their',
      'mapping tables, 5 L3/L4/L10, 9 M2, 10 C2/C3/C5; it is v2.1 FINAL and your binding',
      'contract) on the landed M0 harness + M1 aliases (study impl/scripts/',
      'surface-conformance.mjs and the ledger first; 11 entries carry retiresIn:M2).',
      'No gh (no auth). Scope, red tests first (impl/test/grammar-m2-red.test.mjs):',
      '(1) REGISTRY OWNS THE VOCABULARY: application-semantics.mjs gains the canonical run',
      'phase enum, member-state enum, attention-kind enum (the EIGHT live kinds), the',
      'generated legacy mapping per the section 7.1/7.2 tables, and the two predicates',
      'providerSettled(phase)/applicationTerminal(phase). Surfaces consume the predicates -',
      'no hand-maintained terminal union survives anywhere.',
      '(2) EMISSION FLIP (section 7.1 mapping, exactly): awaiting_plan_approval ->',
      'awaiting_approval; approved -> queued; running -> working; interruption_uncertain ->',
      'uncertain; work_completed -> result_ready (provider-settled, NON-terminal);',
      'selection_required -> awaiting_selection; candidate_selected -> result_selected;',
      'planning_failed -> failed with cause planning; input_required outline -> working',
      'plus attention. closed is DEAD: delete it from PROVIDER_EXECUTION_SETTLED_PHASES',
      'and APPLICATION_RUN_TERMINAL_PHASES (application.mjs:117-124), from',
      'application-cli.mjs TERMINAL_RUN_PHASES (:29), and from the application-client.mjs',
      'completed bucket (:251). start_failed stays a member state with cause start, never',
      'a Run phase. paused masks interrupted (section 7.1 precedence).',
      '(3) CONSUMER RE-REPORTS: wave.mjs phase branches (:11 TERMINAL_PHASES, :12',
      'SUCCESS_RESTING, :85-86 blockedFor) and story.mjs member-state surfaces re-report',
      'canonical per section 7.2; attention kind candidate_selection serializes as',
      'select_candidate (section 7.3 mapping row) wherever the kind string surfaces.',
      '(4) L3 GENERALIZED: every non-success terminal view carries a typed cause;',
      'completed keeps terminalCause null legal (phase92-read-only pins stay green).',
      '(5) H5 DO-PATH ITEM (v2.1 amendment bc6edd9): resolve the do-path reason divergence',
      'exactly as docs/36 section 4.2 H5 schedules it for M2.',
      '(6) LEDGER: resolve all 11 retiresIn:M2 rows (removal-only; checkLedgerMonotone',
      'stays green); checkEnumStrings then enforces canonical for the resolved strings.',
      '(7) TEST RE-PINS the doc names for M2: phase67-run-terminality re-pins onto the',
      'registry predicates; grammar-m1-red C2 re-baselines onto section 7 vocabulary;',
      'wave-driver-red re-pins wave re-reports. Outstanding advertised actionIds are',
      'invalidated by the flip BY DESIGN (R-KM-15) - the scope-mismatch refusal plus',
      're-read is the intended recovery; do not weaken freshness to avoid it.',
      'DO NOT change transport command names, card().commands, or WEB_APPLICATION_ENTRIES',
      '(that is M4; UA5 parity must hold). Red contracts to cut: M2-1 no surface',
      'serializes a legacy phase string (C3 total over the extraction); M2-2 every',
      'terminal-union consumer uses the registry predicates; M2-3 closed is grep-clean in',
      'the four named sites; M2-4 wave re-reports canonical; M2-5 non-success terminals',
      'carry cause while completed keeps null; M2-6 candidate_selection -> select_candidate',
      'serialization; M2-7 the 11 M2 ledger rows are resolved and monotonicity holds.',
      'Then focused files green, then FULL SUITE green from the worktree root (node',
      'scripts/run-suite.mjs inside impl/). House style: match neighboring code; comments',
      'only for constraints code cannot show. No git commits, no scratch/log writes',
      'anywhere including /tmp. Do not invoke nested Baton.',
      OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'grammar-m2-2026-07-24'),
    routes: [{ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[m2 ${new Date().toISOString()}] ${line}`);
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
  log(`grammar M2 wave started through baton.waves (${MEMBERS.length} members, objectiveBytes=${Buffer.byteLength(MEMBERS[0].objective)})`);

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
          await run.act('nudge_turn', { message: 'Continue: red-first M2 suite, then the vocabulary flip, then the canonical suite - end the turn when both are green.' });
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
  const stop = await wave.close({ reason: 'grammar M2 wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'grammar M2 driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
