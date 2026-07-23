import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// #33 scratchpad contract wave: ONE codex seat through baton.waves — draft the
// structured workflow-ephemeral scratchpad decisions contract (issue #33 + its
// reframe comment: the scratchpad is the WRITE SURFACE into the task-ephemeral
// horizon, not a new subsystem). Grounding: scratch family (coordination-store.mjs
// :11552-11651), boards F10 non-evented reads, REPL bindings slice rule, KG
// horizons, F14 sanitization, the readScratch evented-read precedent to avoid.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/scratchpad-2026-07-23';
const evidencePath = resolve(evidenceDir, 'evidence-contract.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines — Grep',
  'to locate, then Read targeted line ranges. Bound every large command output with',
  'tail/grep. Write large files in chunks. Use FIXED CLOCKS in any fixture you sketch.',
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'scratchpad-contract-drafter',
    exact: Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/scratchpad-decisions.md`]),
    report: `${relativeRoot}/scratchpad-decisions.md`,
    objective: [
      `Write ${relativeRoot}/scratchpad-decisions.md — the implementation-grade decisions`,
      'contract for issue #33. The issue body AND its reframe comment are inlined here',
      '(runtime isolation has no gh auth — do NOT call gh): "Seeded by operator advice: agents',
      'steer themselves with notes constantly and well — banning scratch writes fights a natural',
      'behavior instead of housing it. Give it a deliberate home: a structured,',
      'workflow-ephemeral scratchpad as a proper tool surface, instead of hodgepodge .md files',
      'in random paths." REFRAME: "NOT a separate scratchpad subsystem. Workers already have',
      'read access to task/workflow/project horizon projections (KG-1) and query access to the',
      'project KG with ownership binding (recallKnowledge, coordinator.mjs:9039-9052). The gap',
      'is the WRITE surface into the task-ephemeral horizon: typed worker-authored entries',
      '(note/plan/doubt/link) that become candidates for elevation. The scratchpad = that write',
      'surface, scoped per-worker and workflow-shared, ephemeral by default. Elevation:',
      'candidacy is CONTINUOUS (survives worker death); the orchestrator elevates at',
      'end-of-task and end-of-workflow (settle-time admit gate)."',
      'In the style of',
      'docs/reference/evidence/turn-checkpoints-2026-07-23/31b-steering-acts-decisions.md',
      '(numbered rules, file:line grounding, red-test list, boundaries, validation). Required',
      'substance: typed entries (note/plan/doubt/link) with closed shapes and bounds;',
      'partitions per-worker and workflow-shared (the boards/bindings slice rule,',
      'coordination-store.mjs:12057-12210 and the repl bindings at :12600+); hub-authored',
      'identity + content addressing; event kinds and the full fold surface (_apply :7158+,',
      'PROJECTION_CHECKPOINT_FIELDS :89-113, snapshot() :9937+, run-stop guard :7196-7218);',
      'non-evented cached reads with a fence (the F10 board rule — readScratch\'s evented',
      'read at :11636-11641 is the precedent to AVOID, named); the orchestrator-readable',
      'projection for driver steering (a wave driver must be able to read a member\'s',
      'scratchpad — that projection is the point); sanitization with boundedAttentionText/',
      'SECRET_SHAPED_TEXT + provenance marking (application.mjs:196-221, F14); workflow-',
      'ephemeral lifecycle (reap at settle) with promotion climbing the existing paths',
      '(scratch→KG minScratchReaders :11805+, KG-2 orchestrator-admit gate).',
      'READ-ONLY except your output file; never write scratch files (including /tmp). Do not',
      'invoke nested Baton. One shell command per call. Do not mutate credentials, harness',
      'installations, global configuration, or the main checkout.',
      OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[sp ${new Date().toISOString()}] ${line}`);
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
  log(`scratchpad contract wave started through baton.waves (${MEMBERS.length} members)`);

  const terminalRoles = new Set();
  const nudged = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const progress = await wave.progress();
    const line = progress.members.map((entry) => `${entry.role}=${entry.phase}${entry.attention ? `[${entry.attention}]` : ''}`).join(' ');
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line}`);
    // 31-c pattern (w-169 lesson): a paused member gets a nudge, never a 90-minute death.
    for (const entry of progress.members) {
      if (entry.phase !== 'paused' || nudged.has(`${entry.role}:${entry.attention}`)) continue;
      const run = wave.runs.get(entry.role);
      if (!run) continue;
      try {
        const status = await run.status();
        const view = status?.view ?? status ?? {};
        const checkpoint = (Array.isArray(view.attention) ? view.attention : [])
          .find((item) => item?.kind === 'turn_checkpoint' && typeof item?.requestId === 'string');
        if (checkpoint) {
          await run.act('nudge_turn', { message: 'Continue your drafting work.' });
          nudged.add(`${entry.role}:${entry.attention}`);
          log(`steered nudge_turn on ${checkpoint.requestId} for ${entry.role}`);
        }
      } catch (error) {
        log(`nudge for ${entry.role} returned ${error?.code ?? 'unknown'} (recorded)`);
        nudged.add(`${entry.role}:${entry.attention}`);
      }
    }
    for (const entry of progress.members) {
      if (entry.terminal || entry.phase === 'work_completed') terminalRoles.add(entry.role);
    }
    if (Date.now() - startedAt > 100 * 60 * 1000) { log('watchdog'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'scratchpad contract wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'scratchpad contract driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
