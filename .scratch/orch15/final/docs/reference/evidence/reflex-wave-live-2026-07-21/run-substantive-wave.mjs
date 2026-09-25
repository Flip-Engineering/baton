import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Substantive REFLEX wave: three concurrent seats through baton.waves —
// reflex1-implementer (decision channel + settlement integrity), reflex4-implementer
// (application.context_eval), reflex23-spec-drafter (REFLEX-2/3 implementation contracts).

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/reflex-wave-live-2026-07-21';
const evidencePath = resolve(evidenceDir, 'evidence-substantive.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'reflex1-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/messages.mjs', 'impl/src/coordinator.mjs', 'impl/src/application.mjs',
      'impl/src/application-cli.mjs', 'impl/src/application-semantics.mjs',
      'impl/src/mcp-northbound.mjs', 'impl/src/adapter.mjs', 'impl/src/claude-session.mjs',
      'impl/test/reflex1-decision-requests-red.test.mjs', 'docs/PROGRESS.md',
    ]),
    report: null,
    objective: [
      'Implement REFLEX-1 per docs/reference/evidence/reflex-wave-live-2026-07-21/',
      'reflex1-decisions.md (v2) — read it FIRST; it is your binding contract, including the',
      'Part-A settlement-integrity fixes (issue #20: durable pending records, disposition split,',
      'kind-checked answers, duplicate-id rejection) BEFORE the Part-B decision channel. Red',
      'tests first (impl/test/reflex1-decision-requests-red.test.mjs), then implementation, then',
      'focused green, then the full suite green from the worktree root. No git commits, no',
      'scratch/log writes anywhere (including /tmp), no wholesale settlement rewrite.',
    ].join(' '),
  }),
  Object.freeze({
    role: 'reflex4-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/application.mjs', 'impl/src/application-semantics.mjs', 'impl/src/application-cli.mjs',
      'impl/src/mcp-northbound.mjs', 'impl/src/mcp-web-bridge.mjs',
      'impl/test/reflex4-context-eval-red.test.mjs', 'docs/PROGRESS.md',
    ]),
    report: null,
    objective: [
      'Implement application.context_eval per docs/reference/evidence/reflex-wave-live-2026-07-21/',
      'reflex4-decisions.md — read it FIRST; it is your binding contract. Pure-only Bench',
      'evaluation without a Workflow, same DurableContextSession admission path, same cell',
      'identity and projections as the Workflow surface, transport parity (direct/Web/MCP',
      'baton_context_eval/CLI baton context eval). NOTE the red-team F12 refinement (same',
      'directory, reflex-redteam.md): name the non-Workflow manifest-admission authority',
      'explicitly in code comments, and cells citable by boards/packages later MUST be durably',
      'admitted (never stateless-computed-only). Red tests first, then green, then full suite.',
      'No git commits, no scratch/log writes anywhere (including /tmp), no evaluator changes.',
    ].join(' '),
  }),
  Object.freeze({
    role: 'reflex23-spec-drafter',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([
      `${relativeRoot}/reflex2-boards-decisions.md`,
      `${relativeRoot}/reflex3-packages-decisions.md`,
    ]),
    report: `${relativeRoot}/reflex3-packages-decisions.md`,
    objective: [
      'Draft two implementation-grade decisions contracts, in the style of this directory\'s',
      'reflex1-decisions.md (numbered rules, red-test lists, boundaries, validation). Read',
      'docs/32-reflexive-orchestration.md §3.2-3.3 AND this directory\'s reflex-redteam.md',
      'findings F8-F11 FIRST — the contracts MUST resolve them: F8 board item identity (choose',
      'immutable items with successor versions and an explicit claim-migration rule, or mutable',
      'with close-time digest — pick and justify one), claim release/expiry on worker death',
      '(mirror _expireScratchClaims, coordinator.mjs:9591); F9 board-scoped replay-derivable',
      'fence counter (NOT the worker fence — see the scratch claimScratch trap); F10 cached',
      'per-worker projections with a read/polling budget (never the readScratch evented-read',
      'precedent); F11 package provenance derived from the admission ledger event (scratch-oracle',
      'binding pattern, coordination-store.mjs:11572-11585), unique branch names with at least',
      'one ref each, resolve-time revalidation per §93.5 instead of attach-time (or state the',
      'threat model). Ground every rule in the cited code (file:line).',
      `Write ${relativeRoot}/reflex2-boards-decisions.md and ${relativeRoot}/reflex3-packages-decisions.md.`,
      'READ-ONLY otherwise; never write scratch files (including /tmp). Do not invoke nested',
      'Baton. One shell command per call. Do not mutate credentials, harness installations,',
      'global configuration, or the main checkout.',
    ].join(' '),
  }),
]);

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

const log = (line) => console.log(`[subst ${new Date().toISOString()}] ${line}`);
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
  log(`substantive wave started through baton.waves (${MEMBERS.length} members)`);

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
  const stop = await wave.close({ reason: 'substantive REFLEX wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'substantive driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
