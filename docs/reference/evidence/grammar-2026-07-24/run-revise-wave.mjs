import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Grammar revision wave (issue #43, docs/35 v1 → v2): ONE opus seat folds the three
// committed red-team reports (codex/kimi/opus, 30ce6db) into docs/35-unified-control-grammar.md
// and records every fold/rebut decision in a fold ledger for acceptance review.
// Deployment state is isolated under .baton/grammar-2026-07-24-d because a concurrent
// controller (the scratchpad contract wave) is live on the default root; worktree capacity
// stays correctly repo-shared. Driver carries the 31-c steering loop with requestId-keyed
// nudge dedup (de818e3). Objective stays well under the 4KiB cap ("Run objective is
// required" is the machinery's misleading message for oversize objectives).

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/grammar-2026-07-24';
const evidencePath = resolve(evidenceDir, 'evidence-revise.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/surface-audit-smoke.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines — Grep',
  'to locate, then Read targeted line ranges. Bound every large command output with',
  'tail/grep. Write large files in chunks.',
].join(' ');

const FOLD = [
  `Revise docs/35-unified-control-grammar.md (v1 to v2) by folding the three committed`,
  `red-team reports: ${relativeRoot}/redteam-codex.md, ${relativeRoot}/redteam-kimi.md,`,
  `${relativeRoot}/redteam-opus.md. Read ALL THREE reports and the doc in full FIRST.`,
  'Rules: (1) Every P0 and P1 finding is either FOLDED into the doc or explicitly REBUTTED.',
  `Record every decision in ${relativeRoot}/fold-ledger.md as one line per finding:`,
  'finding-id, verdict (FOLDED with the doc section it landed in, or REBUTTED with the',
  'file:line grounding that defeats it). (2) Where seats conflict, prefer the position',
  'grounded in executable contracts (pinned tests, authority digests) and cite both sides.',
  '(3) The convergent P0s you MUST resolve: the portable do-block shape (law L2) — define it',
  'as {action, inputs} preserving freshness + semantic-authority admission, or scope L2 down',
  'to what survives the digest checks; canonical-operation completeness (context ops,',
  'checkpoint acts, deployment effects, application.shutdown, the goal/plan family) — the',
  'canonical table must lose nothing the 41-op set carries; the provider-settled vs',
  'application-terminal lifecycle distinction restored in the phase mapping; checkpoint',
  'attention semantics (three acts, two options, and a trust-gate re-run that is not an',
  'answer) fixed in the ontology; the episode fold must preserve role x generation',
  'addressing and the admission matrix pinned as executable evidence guarantees.',
  '(4) Preserve the doc structure and section numbering where possible; bump the status',
  "header to 'v2 (post-red-team)'. (5) Doc-only — do NOT touch impl/ or test files.",
].join(' ');

const CONSTRAINTS = [
  'READ-ONLY outside your two scoped output files. Never write scratch files (including',
  '/tmp). Do not call gh (no auth in your runtime). Do not invoke nested Baton. One shell',
  'command per call. Do not mutate credentials, harness installations, global configuration,',
  'or the main checkout.',
].join(' ');

// Attempt salt: runs.start is idempotent by objective digest, so every relaunch
// must change the objective or members attach to stopped prior runs.
const ATTEMPT = new Date().toISOString();
const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'grammar-reviser-opus',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze(['docs/35-unified-control-grammar.md', `${relativeRoot}/fold-ledger.md`]),
    report: `${relativeRoot}/fold-ledger.md`,
    objective: [
      `[attempt: ${ATTEMPT}]`,
      FOLD, CONSTRAINTS, OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'grammar-2026-07-24-d'),
    routes: [{ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[grev ${new Date().toISOString()}] ${line}`);
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
  log(`grammar revision wave started through baton.waves (${MEMBERS.length} members, objectiveBytes=${Buffer.byteLength(MEMBERS[0].objective)})`);

  const terminalRoles = new Set();
  const nudged = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const progress = await wave.progress();
    const line = progress.members.map((entry) => `${entry.role}=${entry.phase}${entry.attention ? `[${JSON.stringify(entry.attention)}]` : ''}`).join(' ');
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line}`);
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
          await run.act('nudge_turn', { message: 'Continue the fold and finish both files (doc v2 + fold ledger).' });
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
    if (Date.now() - startedAt > 75 * 60 * 1000) { log('watchdog'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'grammar revision wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'grammar revision driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
