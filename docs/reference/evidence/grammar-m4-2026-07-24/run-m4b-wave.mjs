import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Grammar M4b wave (docs/36 section 9 M4, second slice; issue #43): ONE opus seat - the
// transport flip. MCP tool tables and Web entries render from registry v2; canonical names
// become admitted transport identities beside retained legacy aliases; parked-envelope
// reconciliation across the boundary is a named conformance case; C8 cut; CLI.md/MCP.md
// inventory blocks generated; the final 83 ledger rows burn.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidencePath = resolve(evidenceDir, 'evidence-m4b.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/grammar-m4b-red.test.mjs', 'impl/test/surface-conformance-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize, issue #28): a single stream-json frame over 8MiB',
  'kills your run. NEVER Read a whole file over ~1500 lines - Grep to locate, then Read',
  'targeted ranges. Bound every large command output with tail/grep. Write large files in',
  'chunks. FIXED CLOCKS in every fixture (the clock lint enforces this).',
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'grammar-m4b-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/mcp-northbound.mjs',
      'impl/src/web-northbound.mjs',
      'impl/src/mcp-web-bridge.mjs',
      'impl/src/application.mjs',
      'impl/src/application-semantics.mjs',
      'impl/scripts/surface-conformance.mjs',
      'impl/scripts/surface-divergence-ledger.json',
      'impl/scripts/render-surface-docs.mjs',
      'impl/CLI.md',
      'impl/MCP.md',
      'impl/test/grammar-m4b-red.test.mjs',
      'impl/test/surface-conformance-red.test.mjs',
      'impl/test/phase64-integrated-run-application.test.mjs',
      'impl/test/phase12-web-northbound.test.mjs',
      'impl/test/phase16-mcp-northbound.test.mjs',
      'impl/test/phase72-kimi-orchestrator-mcp.test.mjs',
      'impl/test/phase12-web-operator.test.mjs',
    ]),
    report: null,
    objective: [
      'Implement grammar phase M4b - the transport flip - per',
      'docs/36-unified-control-grammar.md (READ IT FIRST: sections 6.1, 8.1, 8.2 H10-scope,',
      '9 M4, 10 C8/C9, 11; v2.1 FINAL binding) on the landed M4a registry v2 (study',
      'application-semantics.mjs registry entries + surface-conformance.mjs + the 83-row',
      'ledger first). This is the LAST breaking-surface phase. No gh. Red tests first',
      '(impl/test/grammar-m4b-red.test.mjs):',
      '(1) WEB RENDERER: WEB_APPLICATION_ENTRIES + COMMAND_CAPABILITY app-half + arg sets +',
      'reconcilable/read-only classes render from registry v2 entries (web-northbound.mjs).',
      'Canonical transport names become ADMITTED beside retained legacy names (both resolve',
      'to one operation; admitted identity recorded as the SPELLING USED). card().commands',
      '(application.mjs:10668) lists legacy + canonical; kernel/goal-plan literal halves',
      'unchanged (C9 stays green). PARKED-ENVELOPE CASE (doc 9 M4, R-KM-8): a reconcilable',
      'envelope admitted pre-flip under a legacy name must replay/reconcile identically',
      'post-flip - a named red test, not an assumption.',
      '(2) MCP RENDERER: the baton_* ordinary tool table (mcp-northbound.mjs) renders from',
      'registry entries (names via deriveSurfaceNames, schemas from registry input schemas,',
      'annotations from idempotent/destructive/examples); canonical tools appear beside',
      'retained legacy tools; the fleet_* kernel table and reflex tables unchanged. The',
      'mcp-web-bridge ORDINARY_COMMANDS becomes the remote_bridge profile projection of the',
      'registry (same five operations today - no reachability change this phase).',
      '(3) C8 (doc 4.2 H10 scope, 10 C8): the canonical serialization pin - envelope +',
      'outline top-level + registry-owned nested objects emit in registry-pinned order via',
      'a serialization-layer normalization; parsers stay order-insensitive; digest/replay',
      'identities untouched (sorted-key canonical form). Cut as a conformance contract.',
      '(4) DOC GENERATION: impl/scripts/render-surface-docs.mjs renders the CLI.md verb-',
      'inventory block and the MCP.md tool-inventory block from the registry between',
      'BEGIN/END GENERATED markers; committed output current; a conformance check fails if',
      'the committed blocks drift from the renderer.',
      '(5) LEDGER: burn the final 83 rows (mcp/web names now derivable or retained-as-',
      'ledgered-alias per doc 9 M5 plan); removal-only, monotonicity green; SC1 novel-empty',
      'green with the new canonical names present.',
      '(6) PINNED TESTS: update phase64 UA5 card-list pin, phase12-web-northbound entries,',
      'phase16-mcp-northbound + phase72 inventories, phase12-web-operator bus names exactly',
      'as the flip requires - these are the doc-named M4 work items; keep every behavioral',
      'assertion, change only the name/inventory pins.',
      '(7) Red contracts: M4B-1 canonical web command admits + same outcome as legacy with',
      'spelling-true admitted identity; M4B-2 parked pre-flip envelope reconciles; M4B-3',
      'canonical MCP tool executes beside legacy; M4B-4 C8 order pin holds and a scrambled',
      'emitter is caught; M4B-5 generated doc blocks match committed; M4B-6 ledger empty of',
      'mcp/web rows, monotonicity green; M4B-7 kernel/authoring tables byte-unchanged.',
      'Then focused green, then FULL SUITE green from the worktree root (node',
      'scripts/run-suite.mjs inside impl/). NOTE: the concurrent session has an in-flight',
      'red D9 stall-timing test in wave-driver-policy-red.test.mjs on the MAIN checkout;',
      'your pinned worktree may inherit its committed form - if D9 alone is red, it is not',
      'yours. Match neighboring house style. FIXED CLOCKS. No git commits, no scratch/log',
      'writes including /tmp. No nested Baton.',
      OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'grammar-m4-2026-07-24'),
    routes: [{ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[m4b ${new Date().toISOString()}] ${line}`);
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
  log(`grammar M4b wave started through baton.waves (${MEMBERS.length} members, objectiveBytes=${Buffer.byteLength(MEMBERS[0].objective)})`);

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
          await run.act('nudge_turn', { message: 'Continue: red-first M4b suite, then the transport renderers, then the canonical suite - end the turn when both are green.' });
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
  const stop = await wave.close({ reason: 'grammar M4b wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'grammar M4b driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
