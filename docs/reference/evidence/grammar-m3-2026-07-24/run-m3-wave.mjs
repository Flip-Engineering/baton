import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Grammar M3 wave (docs/36-unified-control-grammar.md section 9 M3, issue #43): ONE kimi seat
// through baton.waves - member unification + view/watch consolidation + the episode fold with
// its addressing axes (the phase docs/36 section 11 flags highest-risk). Same converged driver
// skeleton (status-hash stall marker, requestId nudges, 20min stall / 3h cap), detached.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidencePath = resolve(evidenceDir, 'evidence-m3.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/grammar-m3-red.test.mjs', 'impl/test/surface-conformance-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize, issue #28): a single stream-json frame over 8MiB',
  'kills your run. NEVER Read a whole file over ~1500 lines - Grep to locate, then Read',
  'targeted ranges. Bound every large command output with tail/grep. Write large files in',
  'chunks. FIXED CLOCKS in every fixture (the clock lint enforces this).',
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'grammar-m3-implementer',
    exact: Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/application-semantics.mjs',
      'impl/src/application.mjs',
      'impl/src/application-client.mjs',
      'impl/src/application-cli.mjs',
      'impl/src/web-northbound.mjs',
      'impl/src/web-operator.mjs',
      'impl/src/mcp-northbound.mjs',
      'impl/src/wave.mjs',
      'impl/scripts/surface-conformance.mjs',
      'impl/scripts/surface-divergence-ledger.json',
      'impl/test/grammar-m3-red.test.mjs',
      'impl/test/grammar-m2-red.test.mjs',
      'impl/test/surface-conformance-red.test.mjs',
      'impl/test/phase92-episode-workstream-red.test.mjs',
      'impl/test/phase92-episode-attribution-red.test.mjs',
      'impl/test/phase64-application-cli.test.mjs',
    ]),
    report: null,
    objective: [
      'Implement grammar phase M3 - member unification + read consolidation + the episode',
      'fold - per docs/36-unified-control-grammar.md (READ IT FIRST: sections 3 member/',
      'candidate/work-sentinel, 4.1 read row + banned list + note-double-dagger (the',
      'episode fold axes), 6 rows run.view/run.watch/run.member.*, 9 M3, 11 honest edges;',
      'v2.1 FINAL is your binding contract) on the landed M0/M1/M2 stack (study',
      'impl/scripts/surface-conformance.mjs, the ledger, grammar-m1/m2-red tests first).',
      'This is the phase the doc flags HIGHEST RISK; the phase92 episode contracts are the',
      'acceptance gate. No gh (no auth). Scope, red tests first',
      '(impl/test/grammar-m3-red.test.mjs):',
      '(1) EPISODE FOLD (doc 4.1 note-double-dagger, R-OP-3 repairs): run.view gains role',
      '(with the explicit value none selecting the run-level aggregate - a DISTINCT',
      'projection, phase92-episode-attribution :105-106) and generation (the durable',
      'workflow round, never a Plan version) selectors plus the dotted section spelling',
      '--section episode.CHAPTER (total over the chapter enum); episode detail maps onto',
      'the existing depth tail (item|content|evidence). Port the four cross-argument',
      'admission rules VERBATIM (pageCursor only output+content; content only output|help;',
      'generation=>role; waitMs=>cursor). Cross-role and cross-generation evidence',
      'isolation is a contract OF THE FOLD. The continuation.operation string flips',
      'run.episode -> run.view in the SAME commit as the section rename',
      '(phase92-episode-workstream :92), and the browser-desk element ids + bus operations',
      'pinned at :167-175 move with it (web-operator.mjs). run.episode stays admitted as a',
      'dispatch-layer alias (M1 mechanism) until M5.',
      '(2) READ CONSOLIDATION (doc 4.1 read row, R-OP-9): run.view absorbs run.wait as',
      '--until settled|terminal (deployment-bounded condition wait via the registry',
      'predicates); run.watch is the event-channel read (progress|events|output|changes,',
      '--to for output, followPolicy-gated) - both as canonical aliases over the existing',
      'operations, admitted dispatch-layer only.',
      '(3) MEMBER UNIFICATION (doc 3): run.member.view/send/interrupt/stop land as',
      'canonical aliases of run.workstreams / workstream.notify / interrupt / ',
      'workstream.stop with STRUCTURED {role, generation?} addressing; generation defaults',
      'to the current durable round; a bare role with a live predecessor-generation worker',
      'fails with the existing application_control_recipient_ambiguous; the work sentinel',
      'is accepted by run.send only, rejected by member ops; a workflow role literally',
      'named work is refused at wave admission (registry lint). run.steer is UNTOUCHED',
      '(preserved compatibility command through M5).',
      '(4) LEDGER: resolve every row this consolidation retires (removal-only,',
      'monotonicity green); NO transport-name changes (card().commands and',
      'WEB_APPLICATION_ENTRIES byte-stable - M4; UA5 parity in phase64-application-cli',
      'must hold).',
      '(5) Red contracts: M3-1 the exact phase92 attribution call (topic result, role',
      'reviewer, generation 2, detail evidence) is expressible and byte-equal through',
      'run.view; M3-2 role none returns the aggregate, distinct from any role; M3-3 the',
      'four admission rules refuse exactly as before through the new entry; M3-4',
      'continuation + desk ids flipped atomically; M3-5 member send with structured',
      'address resolves per the two-clocks rule and the ambiguity refusal; M3-6 work',
      'sentinel accepted/rejected per surface; M3-7 view --until settles on the registry',
      'predicates; M3-8 ledger rows resolved, monotonicity + UA5 parity green.',
      'Then focused green, then FULL SUITE green from the worktree root (node',
      'scripts/run-suite.mjs inside impl/). Match neighboring house style. FIXED CLOCKS.',
      'No git commits, no scratch/log writes including /tmp. No nested Baton.',
      OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'grammar-m3-2026-07-24'),
    routes: [{ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[m3 ${new Date().toISOString()}] ${line}`);
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
  log(`grammar M3 wave started through baton.waves (${MEMBERS.length} members, objectiveBytes=${Buffer.byteLength(MEMBERS[0].objective)})`);

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
          await run.act('nudge_turn', { message: 'Continue: red-first M3 suite, then the consolidation, then the canonical suite - end the turn when both are green.' });
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
  const stop = await wave.close({ reason: 'grammar M3 wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'grammar M3 driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
