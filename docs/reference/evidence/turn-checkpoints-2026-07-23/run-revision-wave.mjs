import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Turn-checkpoints contract-REVISION wave: two seats folding the binding red-team
// briefs (31a-redteam.md / 31b-redteam.md) into the v1 contracts. SHARED DECISIONS
// are pinned inside the briefs — both seats must honor them identically.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/turn-checkpoints-2026-07-23';
const evidencePath = resolve(evidenceDir, 'evidence-revision.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const SEATS = Object.freeze([
  Object.freeze({ role: '31a-reviser', contract: '31a-pause-records-decisions.md', report: '31a-redteam.md' }),
  Object.freeze({ role: '31b-reviser', contract: '31b-steering-acts-decisions.md', report: '31b-redteam.md' }),
]);

const MEMBERS = Object.freeze(SEATS.map((seat) => Object.freeze({
  role: seat.role,
  exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
  scope: Object.freeze([`${relativeRoot}/${seat.contract}`]),
  report: `${relativeRoot}/${seat.contract}`,
  objective: [
    `Revise ${relativeRoot}/${seat.contract} (v1 -> v2) per the BINDING revision brief`,
    `${relativeRoot}/${seat.report} — read it FIRST. Every numbered finding MUST be resolved`,
    'or explicitly rebutted with file:line code evidence. The brief pins SHARED DECISIONS',
    '(key space, story.mjs status, attention classification, the coordination-store.mjs:10630',
    'edit owner) that the sibling contract honors identically — do NOT deviate from them,',
    'and where your contract references the sibling\'s, state the dependency rather than',
    'duplicating the edit. Keep the contract style (numbered rules, file:line grounding,',
    'red-test lists, boundaries, validation). Verify every citation you touch against the',
    'actual code — v1 had wrong line numbers and unexamined seams. Add a short',
    '"## v2 revisions" section listing each finding and its resolution.',
    'READ-ONLY except your contract file; never write scratch files (including /tmp). Do not',
    'invoke nested Baton. One shell command per call. Do not mutate credentials, harness',
    'installations, global configuration, or the main checkout. Use FIXED CLOCKS in any test',
    'fixture you sketch. Never Read a whole file over ~1500 lines (Grep + ranged reads);',
    'bound command outputs with tail/grep.',
  ].join(' '),
})));

const baton = await openBaton({
  repo,
  advanced: {
    routes: [{ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[tcrev ${new Date().toISOString()}] ${line}`);
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
  log(`turn-checkpoints revision wave started through baton.waves (${MEMBERS.length} members)`);

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
  const stop = await wave.close({ reason: 'turn-checkpoints revision wave settled.' });
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
