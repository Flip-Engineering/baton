import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// 31-c acceptance wave (issue #31, live acceptance): a wave member with an ordinary
// multi-part task will pause mid-task (turn ends, no diff yet) — and SURVIVE via
// driver steering instead of dying to the gate. The driver nudges at each
// turn_checkpoint and claims at the end. ZERO prompt-coaching in the objective:
// no "never pause", no "no subagents", no "write skeleton first" (docs/35 §2.3 rule 11).

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/turn-checkpoints-2026-07-23';
const reportPath = `${relativeRoot}/three-part-notes.md`;
const evidencePath = resolve(evidenceDir, 'evidence-31c.json');
const receiptsPath = resolve(evidenceDir, 'receipts-31c.md');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const MEMBER = Object.freeze({
  role: 'note-writer',
  exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
  scope: Object.freeze([reportPath]),
  report: reportPath,
  objective: [
    `Write ${reportPath}, a short three-part engineering note about baton's turn-checkpoint`,
    'design (docs/35-turn-checkpoints.md). Part one headed `## 1. the trap` (what turn-based',
    'gating did to paused workers). Part two headed `## 2. the checkpoint` (what a pause',
    'record is and who steers it). Part three headed `## 3. the proof` (this very wave — a',
    'worker pausing and being nudged onward). One short paragraph per part, plain prose,',
    'grounded in the doc. Work through the parts in order.',
  ].join(' '),
});

const baton = await openBaton({
  repo,
  advanced: {
    routes: [{ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[31c ${new Date().toISOString()}] ${line}`);
const receipts = [];
const receipt = (line) => { receipts.push(`- ${new Date().toISOString()} ${line}`); log(line); };
let failure = null;
let wave = null;
const startedAt = Date.now();
try {
  const readiness = await baton.doctor();
  const ready = readiness.routes.find((candidate) => (
    candidate.harness === MEMBER.exact.harness && candidate.model === MEMBER.exact.model && candidate.effort === MEMBER.exact.effort
  ));
  if (ready?.state !== 'ready') {
    throw Object.assign(new Error(ready?.summary ?? 'route unavailable'), { code: ready?.code ?? 'route_unavailable' });
  }
  wave = await baton.waves.start({
    repoRoot: repo,
    members: [{ role: MEMBER.role, exact: MEMBER.exact, scope: [...MEMBER.scope], report: MEMBER.report, objective: MEMBER.objective }],
  });
  receipt('wave started (note-writer); watching for turn_checkpoint pauses to steer, never to kill');

  const acts = [];
  let claimed = false;
  let terminal = false;
  while (!terminal && Date.now() - startedAt < 35 * 60 * 1000) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 15000));
    const progress = await wave.progress();
    const member = progress.members.find((entry) => entry.role === MEMBER.role);
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s phase=${member?.phase} attention=${JSON.stringify(member?.attention ?? null)?.slice(0, 160)}`);
    const run = wave.runs.get(MEMBER.role);
    if (!run) continue;
    const status = await run.status();
    const view = status?.view ?? status ?? {};
    const attention = Array.isArray(view.attention) ? view.attention : [];
    const checkpoint = attention.find((item) => item?.kind === 'turn_checkpoint' && typeof item?.requestId === 'string');
    if (checkpoint && acts.every((act) => act.pauseId !== checkpoint.requestId) && !claimed) {
      const actKind = acts.length < 2 ? 'nudge_turn' : 'claim_turn';
      try {
        const inputs = actKind === 'nudge_turn'
          ? { message: 'Continue with the next part of the note.' } : {};
        const result = await run.act(actKind, inputs);
        acts.push({ pauseId: checkpoint.requestId, act: actKind, result: 'ok' });
        receipt(`steered ${actKind} on ${checkpoint.requestId} (pause #${acts.length}) — the worker LIVES`);
        if (actKind === 'claim_turn') claimed = true;
      } catch (error) {
        acts.push({ pauseId: checkpoint.requestId, act: actKind, result: `error:${error?.code ?? 'unknown'}` });
        receipt(`steer ${actKind} on ${checkpoint.requestId} returned ${error?.code ?? 'unknown'} — recorded`);
      }
    }
    if (member?.terminal || member?.phase === 'work_completed') terminal = true;
  }
  if (acts.filter((act) => act.act === 'nudge_turn' && act.result === 'ok').length < 1) {
    throw Object.assign(new Error('no successful nudge on any turn_checkpoint — the acceptance loop did not run'), { code: 'acceptance_no_nudge' });
  }

  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) receipt(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: '31-c acceptance wave settled.' });
  receipt(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown} pumpQuiescent=${wave.pumpQuiescent}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, acts, outcomes, stops: stop.stops, pumpQuiescent: wave.pumpQuiescent, waveEvidence: wave.evidence() }, null, 2)}\n`);
  writeFileSync(receiptsPath, `# 31-c acceptance receipts (issue #31)\n\n${receipts.join('\n')}\n`);
  receipt('evidence + receipts written');
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: '31-c driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
