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
      'Implement grammar phase M0 — the surface-conformance harness and allowed-divergence',
      'ledger — per docs/35-unified-control-grammar.md (READ IT FIRST, especially §6, §6.1,',
      '§7, §8.4, §9 M0, §10; it is v2 with red-team findings folded and is your binding',
      'contract) plus this issue-#44 scope (inlined; your runtime has no gh auth — do NOT call',
      'gh): turn the impl/scripts/surface-audit.mjs extraction into executable conformance',
      'contracts with an allowed-divergence ledger seeded from the full current audit, so the',
      'contracts are GREEN TODAY by explicit exception, every future M-phase shrinks the',
      'ledger, and a NEW divergence (a surface name, phase string, or enum value not derivable',
      'from the canonical table and not in the ledger) is RED immediately. NO behavior change',
      'to any production surface. Deliverables, red tests first:',
      '(1) impl/scripts/surface-conformance.mjs exporting: CANONICAL_OPERATIONS — the docs/35',
      '§6 table as data (canonical noun.verb key → per-surface derived names via one',
      'deriveSurfaceNames(key) function implementing §6.1 exactly: embedded path, CLI words,',
      'MCP baton_ prefix underscore join, web underscore join); classifySurfaces(inventory,',
      'ledger) returning {conformant, ledgered, novel} for every extracted surface name;',
      'checkEnumStrings(inventory, ledger) doing the same for the §7 phase strings.',
      '(2) impl/scripts/surface-divergence-ledger.json — schemaVersion 1, one entry per',
      'CURRENT divergence {surface, name, canonical (or null where a concept retires),',
      'retiresIn: M1|M2|M3|M4|M5 per the docs/35 §9 phase that removes it}, complete over the',
      'live extraction: every legacy operation name on every surface (fleet_* and baton_* MCP',
      'dialects, CLI verb rows, web commands, command definitions, registry ops/actions,',
      'embedded methods) and every §7 legacy phase string.',
      '(3) impl/test/surface-conformance-red.test.mjs — contracts: SC1 novel set is EMPTY',
      'against the live tree (every current name conformant or ledgered); SC2 a synthetic',
      'unledgered name (fixture inventory, not the live tree) is classified novel and the',
      'suite-facing check refuses; SC3 deriveSurfaceNames matches the §6.1 worked example',
      'exactly (run.member.stop → baton run member stop / baton_run_member_stop /',
      'run_member_stop / run.member(role).stop()); SC4 every live phase string is canonical',
      'or ledgered with the §7 mapping target; SC5 every ledger entry names a valid retiring',
      'phase and a surface the audit actually extracts (no dead ledger rows); SC6 the ledger',
      'file round-trips canonically (sorted, no duplicates).',
      '(4) Wire the novel-divergence check into impl/scripts/run-suite.mjs directly beside the',
      'existing fixture-clock lint (same pattern: run before spawn, print findings, exit 1),',
      'so a novel divergence is red on the author machine the moment it is written.',
      '(5) Extend impl/scripts/surface-audit.mjs ONLY if the extraction misses a dimension the',
      'ledger needs (keep its exports and smoke test green; extend',
      'impl/test/surface-audit-smoke.test.mjs alongside if you do).',
      'Then run the focused file green, then the FULL SUITE green from the worktree root',
      '(node scripts/run-suite.mjs inside impl/). House style: match the neighboring scripts',
      '(fixture-clock-lint.mjs, suite-hygiene.mjs) — plain ESM, small pure functions, comments',
      'only for constraints code cannot show. No git commits, no scratch/log writes anywhere',
      '(including /tmp).',
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
