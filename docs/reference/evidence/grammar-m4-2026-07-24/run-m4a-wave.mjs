import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Grammar M4a wave (docs/36-unified-control-grammar.md section 9 M4, first slice; issue #43):
// ONE opus seat - registry v2 data completion + CLI/embedded renderers + C9. The MCP/web
// transport flip, C8, doc generation, and the remaining ledger burn are M4b. Bespoke driver
// skeleton retained (createWaveDriver is mid-iteration in the concurrent session's dirty tree).

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidencePath = resolve(evidenceDir, 'evidence-m4a.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/grammar-m4a-red.test.mjs', 'impl/test/surface-conformance-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize, issue #28): a single stream-json frame over 8MiB',
  'kills your run. NEVER Read a whole file over ~1500 lines - Grep to locate, then Read',
  'targeted ranges. Bound every large command output with tail/grep. Write large files in',
  'chunks. FIXED CLOCKS in every fixture (the clock lint enforces this).',
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'grammar-m4a-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/application-semantics.mjs',
      'impl/src/application-cli.mjs',
      'impl/src/application-client.mjs',
      'impl/src/application.mjs',
      'impl/scripts/surface-conformance.mjs',
      'impl/scripts/surface-divergence-ledger.json',
      'impl/scripts/surface-audit.mjs',
      'impl/test/grammar-m4a-red.test.mjs',
      'impl/test/surface-conformance-red.test.mjs',
      'impl/test/phase64-application-cli.test.mjs',
      'impl/test/grammar-m1-red.test.mjs',
      'impl/test/grammar-m3-red.test.mjs',
    ]),
    report: null,
    objective: [
      'Implement grammar phase M4a - registry v2 data completion + CLI/embedded renderers -',
      'per docs/36-unified-control-grammar.md (READ IT FIRST: sections 6, 6.1, 8.1, 8.2,',
      '9 M4, 10 C9; v2.1 FINAL is your binding contract) on the landed M0-M3 stack (study',
      'impl/scripts/surface-conformance.mjs CANONICAL_OPERATIONS and the 237-row ledger',
      'first). This slice is DATA + two renderers; the MCP/web transport flip, C8, and doc',
      'generation are the NEXT slice (M4b) - do NOT change transport names,',
      'card().commands, WEB_APPLICATION_ENTRIES, or MCP tool tables in this slice.',
      'No gh (no auth). Scope, red tests first (impl/test/grammar-m4a-red.test.mjs):',
      '(1) REGISTRY V2 DATA (doc 8.1): every canonical operation in the section-6 table',
      'becomes a complete registry entry in application-semantics.mjs: verb, noun path,',
      'effect, capabilities, profile (ordinary|kernel|authoring|worker|remote_bridge|host),',
      'idempotent, destructive, reconcilable, emergency, input schema (with flagAliases per',
      'H4), output view kind, per-surface enablement + derived names (via the ONE',
      'deriveSurfaceNames function - move/share it from surface-conformance.mjs so registry',
      'and conformance consume the same derivation), aliases (legacy spellings, deprecated',
      'marks), example (H8), help topic. Split the digest: authorityDigest over schemas/',
      'capabilities/effects/enums; presentationDigest over aliases/help/examples (R-OP-11);',
      'actionId freshness and any card pin bind authorityDigest ONLY. requiredCapabilities',
      'stays sorted everywhere (the mcp-web-bridge compares raw order).',
      '(2) CLI RENDERER: the parseBatonCli verb tables and batonCliHelp usage/topic content',
      'in application-cli.mjs render from the registry v2 entries (canonical + alias',
      'spellings, flagAliases, examples) instead of hand rows; behavior byte-identical for',
      'every legacy spelling (phase64-application-cli must stay green with its pins',
      'updated only where the doc names them).',
      '(3) EMBEDDED RENDERER: the client facade method map (application-client.mjs run/',
      'member/view/watch accessors added in M1-M3) derives from the same entries; no',
      'hand-maintained parallel list survives in the client for canonical operations.',
      '(4) C9 (doc 6.1/10): a conformance contract asserting the derived web-name set is',
      'disjoint from the kernel/authoring literal sets (web-northbound COMMAND_CAPABILITY',
      'keys) - asserted from registry data WITHOUT touching web-northbound itself.',
      '(5) LEDGER: resolve exactly the M4 rows whose dimension/surface this slice retires',
      '(cli + embedded + registry name rows now derivable); removal-only, monotonicity',
      'green; the mcp/web rows remain for M4b.',
      '(6) Red contracts: M4A-1 every section-6 operation has a complete v2 entry (closed',
      'field set, no missing profile/effect/example); M4A-2 deriveSurfaceNames is the',
      'single shared derivation (registry and conformance import one function); M4A-3',
      'authorityDigest is stable under alias/help/example edits while presentationDigest',
      'moves; M4A-4 CLI parse of every canonical AND legacy spelling produces byte-',
      'identical envelopes to pre-M4a for legacy (golden pairs); M4A-5 the embedded facade',
      'exposes exactly the registry-enabled canonical methods; M4A-6 C9 disjointness;',
      'M4A-7 resolved ledger rows removed, monotonicity green.',
      'Then focused green, then FULL SUITE green from the worktree root (node',
      'scripts/run-suite.mjs inside impl/). NOTE: the concurrent session has UNCOMMITTED',
      'red-first D-tests in impl/test/wave-driver-policy-red.test.mjs on the MAIN checkout',
      '- your worktree is pinned and will not see them; if your suite run somehow reports',
      'them, they are not yours. Match neighboring house style. FIXED CLOCKS.',
      'No git commits, no scratch/log writes including /tmp. No nested Baton.',
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

const log = (line) => console.log(`[m4a ${new Date().toISOString()}] ${line}`);
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
  log(`grammar M4a wave started through baton.waves (${MEMBERS.length} members, objectiveBytes=${Buffer.byteLength(MEMBERS[0].objective)})`);

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
          await run.act('nudge_turn', { message: 'Continue: red-first M4a suite, then the generators, then the canonical suite - end the turn when both are green.' });
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
  const stop = await wave.close({ reason: 'grammar M4a wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'grammar M4a driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
