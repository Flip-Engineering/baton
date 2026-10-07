import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Grammar M0 implementation wave (issue #44, docs/35 §8.4/§9/§10 v2): ONE opus seat through
// baton.waves — the surface-conformance harness + allowed-divergence ledger, no behavior
// change. LAUNCH ONLY AFTER the red-team findings are folded and docs/35 v2 is COMMITTED
// (worktrees pin at wave-start HEAD; the seat reads the doc from its checkout).

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/grammar-2026-07-24';
const evidencePath = resolve(evidenceDir, 'evidence-m0.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/surface-conformance-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines — Grep',
  'to locate, then Read targeted line ranges. Bound every large command output with',
  'tail/grep. Write large files in chunks. Use FIXED CLOCKS in every test fixture (the',
  'fixture-clock lint in scripts/run-suite.mjs enforces this mechanically).',
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'grammar-m0-implementer',
    exact: Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }),
    scope: Object.freeze([
      'impl/scripts/surface-conformance.mjs',
      'impl/scripts/surface-divergence-ledger.json',
      'impl/scripts/surface-audit.mjs',
      'impl/scripts/run-suite.mjs',
      'impl/test/surface-conformance-red.test.mjs',
      'impl/test/surface-audit-smoke.test.mjs',
    ]),
    report: null,
    objective: [
      'Implement grammar phase M0 - the surface-conformance harness and allowed-divergence',
      'ledger - per docs/35-unified-control-grammar.md (READ IT FIRST, especially sections',
      '1.1, 6, 6.1, 7, 8.4, 9-M0, 10, Appendix B; it is v2 FINAL, your binding contract).',
      'Issue #44 scope, inlined (no gh auth - do NOT call gh). Ledger rules (doc section',
      '8.4): bidirectional and append-forbidden (observed divergences must be a subset of',
      'the ledger - anything novel is red; removal is the only legal edit) and dimensioned',
      '(each entry: surface, name, canonical-or-null, dimension name|args|schema|behavior|',
      'enum, retiresIn M1..M5). Contracts GREEN TODAY by explicit exception; NO production',
      'behavior change. Deliverables, red tests first:',
      '(1) EXTEND impl/scripts/surface-audit.mjs (keep exports; extend',
      'impl/test/surface-audit-smoke.test.mjs alongside): add the full Web admitted set',
      '(COMMAND_CAPABILITY keys, impl/src/web-northbound.mjs:17-31, ~19 kernel/goal-plan',
      'names the extraction misses), add D8 (ORDINARY_COMMANDS, mcp-web-bridge.mjs:14-16),',
      'complete phase-literal extraction (selection_required, candidate_selected,',
      'input_required, planning_failed are live strings the regex misses). NOTE:',
      'impl/src/application.mjs contains a NUL byte - read binary-safely (readFileSync',
      'latin1 or equivalent).',
      '(2) impl/scripts/surface-conformance.mjs exporting CANONICAL_OPERATIONS (doc section',
      '6 table as data: canonical key, profile, per-surface names via ONE',
      'deriveSurfaceNames(key) per section 6.1), classifySurfaces(inventory, ledger) ->',
      '{conformant, ledgered, novel}, checkEnumStrings for section-7 strings, and',
      'checkLedgerMonotone(previous, current) refusing any added entry.',
      '(3) impl/scripts/surface-divergence-ledger.json - schemaVersion 1, complete over the',
      'extended extraction (every legacy name on every surface incl. kernel/goal-plan web',
      'literals and D8, every legacy enum string), plus the two seeded behavior rows from',
      'doc section 8.4 (conditional capability filtering application.mjs:8869-8875;',
      'per-deployment MCP schema mutation mcp-northbound.mjs:826).',
      '(4) impl/test/surface-conformance-red.test.mjs: SC1 novel set EMPTY on the live',
      'tree; SC2 a synthetic unledgered name (fixture inventory) is novel and the check',
      'refuses; SC3 deriveSurfaceNames matches the section-6.1 example exactly',
      '(run.member.stop -> baton run member stop / baton_run_member_stop /',
      'run_member_stop / run.member(role).stop()); SC4 every live phase string is',
      'canonical or ledgered with its mapping target; SC5 no dead ledger rows (valid',
      'phase, dimension, extractable surface); SC6 ledger round-trips canonically (sorted,',
      'no duplicates); SC7 monotonicity check refuses an append, accepts a removal.',
      '(5) Wire the novel-divergence + monotonicity check into impl/scripts/run-suite.mjs',
      'beside the fixture-clock lint (same pattern: before spawn, print findings, exit 1).',
      'Then focused files green, then FULL SUITE green from the worktree root (node',
      'scripts/run-suite.mjs inside impl/). House style: match fixture-clock-lint.mjs and',
      'suite-hygiene.mjs - plain ESM, small pure functions, comments only for constraints',
      'code cannot show. FIXED CLOCKS in fixtures. No git commits, no scratch/log writes',
      'anywhere including /tmp. Do not invoke nested Baton.',
      OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'grammar-2026-07-24'),
    routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[m0 ${new Date().toISOString()}] ${line}`);
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
  log(`grammar M0 wave started through baton.waves (${MEMBERS.length} members)`);

  const terminalRoles = new Set();
  const nudged = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const progress = await wave.progress();
    const line = progress.members.map((entry) => `${entry.role}=${entry.phase}${entry.attention ? `[${entry.attention}]` : ''}`).join(' ');
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line}`);
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
          await run.act('nudge_turn', { message: 'Continue the M0 implementation; run the focused tests, then the full suite.' });
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
    if (Date.now() - startedAt > 110 * 60 * 1000) { log('watchdog'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'grammar M0 wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'grammar M0 driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
