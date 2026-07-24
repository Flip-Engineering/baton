import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Grammar M1 implementation wave (docs/35 §9 M1, v2): ONE codex seat through baton.waves —
// registry v2 with canonical names resolving as aliases on every surface, deprecation marks,
// and L2 do-blocks in advertised actions. LAUNCH ONLY AFTER M0 is merged to master
// (worktrees pin at wave-start HEAD; the seat needs the conformance harness + ledger).

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/grammar-2026-07-24';
const evidencePath = resolve(evidenceDir, 'evidence-m1.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/grammar-m1-red.test.mjs', 'impl/test/surface-conformance-red.test.mjs'],
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
    role: 'grammar-m1-implementer',
    exact: Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/application-semantics.mjs',
      'impl/src/application.mjs',
      'impl/src/application-cli.mjs',
      'impl/src/application-client.mjs',
      'impl/src/web-northbound.mjs',
      'impl/src/mcp-northbound.mjs',
      'impl/scripts/surface-conformance.mjs',
      'impl/scripts/surface-divergence-ledger.json',
      'impl/test/grammar-m1-red.test.mjs',
      'impl/test/surface-conformance-red.test.mjs',
    ]),
    report: null,
    objective: [
      'Implement grammar phase M1 per docs/35-unified-control-grammar.md section 9 M1 (READ',
      'the doc FIRST - sections 4, 5 L1/L2, 6, 6.1, 8.1, 9 M1; it is v2 FINAL and your',
      'binding contract) on top of the landed M0 harness (impl/scripts/',
      'surface-conformance.mjs + surface-divergence-ledger.json - study both first).',
      'HARD BOUNDARIES from the doc (red-team folds R-OP-10/R-KM-8/R-CX-9): canonical names',
      'resolve in a DISPATCH-LAYER ALIAS MAP ONLY - they must NOT become',
      'APPLICATION_COMMAND_DEFINITIONS keys, must NOT appear in card().commands',
      '(application.mjs:10668; phase64-integrated-run-application.test.mjs UA5 pins the',
      'list), and must NOT enter WEB_APPLICATION_ENTRIES (web-northbound.mjs:13) - every',
      'legacy D3 key and flag set stays the transport projection verbatim so parked',
      'reconcilable envelopes keep matching stored scope keys. reconcilable is a',
      'per-operation registry field; no alias may flip a durability class (run.steer stays',
      'the only reconcilable:false command, untouched). Scope, red tests first',
      '(impl/test/grammar-m1-red.test.mjs):',
      '(1) REGISTRY ALIAS AUTHORITY: application-semantics.mjs registry entries gain',
      'aliases (canonical name -> legacy operation) + deprecated marks on legacy spellings;',
      'keep the registry digest deterministic; do NOT change any input schema.',
      '(2) DISPATCH-LAYER RESOLUTION: the Web bus resolves a canonical command name to its',
      'legacy definition at admission (alias map derived from the registry; admitted',
      'transport identity recorded as the LEGACY name so replay/reconciliation is',
      'unchanged); the CLI parses canonical verb spellings to the same envelopes as legacy',
      '(parse tables from the registry alias map).',
      '(3) SAME-SURFACE L2 (doc 5 L2, kind-portable/id-local): every advertised action in a',
      'RunView (nextActions[], attention[]) carries do: {action: {kind, actionId}, inputs}',
      'with the exact bound inputs (planDigest for approve_plan; requestId + response shape',
      'for answers; the three-variant checkpoint response continue/wait/settle mapping to',
      'nudge_turn/wait_turn/claim_turn). Executing the advertised do verbatim ON THE SAME',
      'SURFACE succeeds from outline depth alone. Do NOT attempt cross-surface identity',
      '(that is M2+) and do NOT touch the mcp-web-bridge authority digest path beyond',
      'carrying the block (requiredCapabilities stays sorted -',
      'application-semantics.mjs:581-584).',
      '(4) LEDGER SHRINK: move every ledger entry retiresIn:M1 to resolution; ledger edits',
      'are removals only (checkLedgerMonotone must stay green); SC1 novel-empty and the',
      'whole M0 conformance suite stay green.',
      '(5) Red tests: M1-1 canonical Web command admits and returns the identical outcome',
      'as its legacy spelling (same authority, same view modulo cursor/freshness; admitted',
      'transport identity = legacy name); M1-2 canonical CLI verb parses to the same',
      'envelope as legacy; M1-3 every advertised action carries an executable do block and',
      'executing it verbatim same-surface succeeds (approve_plan round-trip from outline',
      'WITHOUT deeper reads); M1-4 legacy spellings marked deprecated in registry/help but',
      'execute unchanged; M1-5 registry digest stable across two constructions; M1-6',
      'card().commands and WEB_APPLICATION_ENTRIES byte-identical to pre-M1 (UA5 parity).',
      'Then focused files green, then FULL SUITE green from the worktree root (node',
      'scripts/run-suite.mjs inside impl/). House style: match neighboring code; comments',
      'only for constraints code cannot show. FIXED CLOCKS in fixtures. No git commits, no',
      'scratch/log writes anywhere including /tmp. Do not call gh. Do not invoke nested',
      'Baton.',
      OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'grammar-m1-2026-07-24'),
    routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[m1 ${new Date().toISOString()}] ${line}`);
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
  log(`grammar M1 wave started through baton.waves (${MEMBERS.length} members)`);

  const terminalRoles = new Set();
  const nudged = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const progress = await wave.progress();
    const line = progress.members.map((entry) => `${entry.role}=${entry.phase}${entry.attention ? `[${entry.attention}]` : ''}`).join(' ');
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
        // Dedup on the checkpoint requestId (de818e3 lesson): the classification string
        // stringifies as [object Object] and collides across successive pauses.
        if (checkpoint && nudged.has(checkpoint.requestId)) continue;
        if (checkpoint) {
          await run.act('nudge_turn', { message: 'Continue the M0 implementation; run the focused tests, then the full suite.' });
          nudged.add(`${entry.role}:${entry.attention}`);
          log(`steered nudge_turn on ${checkpoint.requestId} for ${entry.role}`);
        }
      } catch (error) {
        log(`nudge for ${entry.role} returned ${error?.code ?? 'unknown'} (recorded)`);
      }
    }
    for (const entry of progress.members) {
      if (entry.terminal || entry.phase === 'work_completed') terminalRoles.add(entry.role);
    }
    if (Date.now() - startedAt > 110 * 60 * 1000) { log('watchdog'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'grammar M1 wave settled.' });
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
