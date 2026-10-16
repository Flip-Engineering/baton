import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// REPL/KG contract-REVISION wave: four seats, each folding its binding red-team
// report into its contract (v1 -> v2). Reports are authoritative: every numbered
// finding resolved or explicitly rebutted with file:line code evidence.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/repl-kg-wave-2026-07-22';
const evidencePath = resolve(evidenceDir, 'evidence-revision.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const SEATS = Object.freeze([
  Object.freeze({ role: 'repl1-reviser', contract: 'repl1-decisions.md', report: 'repl1-redteam.md', model: 'claude-opus-4-8' }),
  Object.freeze({ role: 'repl23-reviser', contract: 'repl23-decisions.md', report: 'repl23-redteam.md', model: 'claude-sonnet-5' }),
  Object.freeze({ role: 'kg12-reviser', contract: 'kg12-decisions.md', report: 'kg12-redteam.md', model: 'claude-sonnet-5' }),
  Object.freeze({ role: 'kg34-reviser', contract: 'kg34-decisions.md', report: 'kg34-redteam.md', model: 'claude-opus-4-8' }),
]);

const MEMBERS = Object.freeze(SEATS.map((seat) => Object.freeze({
  role: seat.role,
  exact: Object.freeze({ harness: 'claude-code', model: seat.model, effort: 'high' }),
  scope: Object.freeze([`${relativeRoot}/${seat.contract}`]),
  report: `${relativeRoot}/${seat.contract}`,
  objective: [
    `Revise ${relativeRoot}/${seat.contract} (v1 -> v2) per the BINDING red-team report`,
    `${relativeRoot}/${seat.report} — read it FIRST. Every numbered finding MUST be resolved`,
    'in the contract or explicitly rebutted with file:line code evidence (rebuttals need',
    'strong evidence; the report is usually right). Keep the contract style (numbered rules,',
    'file:line grounding, red-test lists, boundaries, validation). Verify every citation you',
    'touch against the actual code — the v1 had wrong line numbers in places. Where the report',
    'offers a FIX direction, adopt it unless code proves it wrong; where findings interact,',
    'resolve them coherently (e.g. one kind-dispatching normalization story, not two hacks).',
    'Add a short "## v2 revisions" header section listing each finding and its resolution.',
    'READ-ONLY except your contract file; never write scratch files (including /tmp). Do not',
    'invoke nested Baton. One shell command per call. Do not mutate credentials, harness',
    'installations, global configuration, or the main checkout.',
  ].join(' '),
})));

const baton = await openBaton({
  repo,
  advanced: {
    routes: [
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
      { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' },
    ],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[rev ${new Date().toISOString()}] ${line}`);
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
  log(`contract-revision wave started through baton.waves (${MEMBERS.length} members)`);

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
  const stop = await wave.close({ reason: 'contract-revision wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'revision driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
