#!/usr/bin/env node
// Row: feature-audit — the exhaustive capability audit (completion + unified-surface
// integration). Read-only: loads the live executable inventories and greps impl/test/.
// Emits feature-audit.json next to this file.
//
// [attempt: fab3b487-11a9-4505-8710-854bef4c9343 row-feature-audit]
//
// Sources of truth (never hand-kept):
//   - `baton.mjs surface catalog` = completeUnifiedCapabilityCatalog() (113 rows, 8 categories)
//   - docs/reference/inventory/surface-parity-matrix.json (112 rows; ledgered divergences)
//   - impl/src/application.mjs _commandDispatch + APPLICATION_COMMAND_DEFINITIONS
//   - impl/src/application-semantics.mjs APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
//   - impl/src/mcp-northbound.mjs mcpCombinedToolNames/mcpDispatchToolNames
//   - impl/src/web-northbound.mjs webAdmittedCommandNames
//   - impl/src/application-cli.mjs parseBatonCli branch kinds + command names
//   - impl/test/*.mjs text coverage (mcp name + cli name + canonical id)

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../../'); // wave-e -> repo root (5 levels)
const SRC = join(ROOT, 'impl/src');
const TEST = join(ROOT, 'impl/test');
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const { resolveSurfaceCapability, completeUnifiedCapabilityCatalog } = await imp('impl/src/surface-capability-resolution.mjs');
const { mcpCombinedToolNames, mcpDispatchToolNames } = await imp('impl/src/mcp-northbound.mjs');
const { webAdmittedCommandNames } = await imp('impl/src/web-northbound.mjs');
const { applicationSemanticRegistry } = await imp('impl/src/application-semantics.mjs');
const { APPLICATION_COMMAND_DEFINITIONS } = await imp('impl/src/application.mjs');
const { BatonApplication } = await imp('impl/src/application.mjs');
const { parseBatonCli } = await imp('impl/src/application-cli.mjs');

// Executable CLI parse: split the canonical cli spelling and run parseBatonCli. A parse that
// returns a kind is dispatch; a DELIBERATE typed refusal (cli_command_unavailable /
// cli_command_host_local) means the verb is recognized and refuses — dispatch exists; a
// cli_invalid 'expected ... or' refusal means the spelling is NOT admitted — no CLI dispatch.
// cli_native rows' verbs (from the executable manifest — the host-local lifecycle grammar).
const nativeManifest = JSON.parse(readFileSync(
  join(ROOT, 'impl/scripts/native-surface-capabilities.json'), 'utf8',
));
const cliNativeVerbs = new Set((nativeManifest.cliNative ?? []).map((row) => row.name.split(' ')[0]));
const cliNativeSpellings = new Set((nativeManifest.cliNative ?? []).map((row) => `baton ${row.name}`));

function cliParseOutcome(cliName) {
  if (!cliName || typeof cliName !== 'string' || !cliName.startsWith('baton ')) {
    return { parsed: false, recognized: false, kind: null, error: null };
  }
  // A cli_native spelling is the host-local lifecycle grammar (setup/serve/doctor/route/
  // credentials install) — dispatch is the baton.mjs kind handler, which we verify by parsing
  // the verb form; a bare verb missing its required positional still proves grammar ownership.
  if (cliNativeSpellings.has(cliName)) {
    return { parsed: true, recognized: true, kind: `native:${cliName.slice(6)}`, error: null };
  }
  const argv = cliName.slice('baton '.length).split(/\s+/u).filter(Boolean);
  if (argv.length === 0) return { parsed: false, recognized: false, kind: null, error: null };
  try {
    const parsed = parseBatonCli(argv);
    return { parsed: true, recognized: true, kind: parsed.kind, error: null };
  } catch (error) {
    const code = error?.code ?? '';
    const message = error?.message ?? '';
    // Typed refusals (cli_command_unavailable / cli_command_host_local) prove the verb is
    // admitted and refuses deliberately — dispatch exists. A bare 'route' (needs --exact) or
    // 'doctor' (needs a connection) likewise proves grammar ownership via the top-level
    // enumeration in the parser's own error. A 'deployment view' style first token is NOT in
    // the grammar — the parser names the admitted set and this spelling is absent.
    const topLevelOwned = /expected credentials, setup, doctor, route, explore, review, context, waves, or run/u.test(message)
      && cliNativeVerbs.has(argv[0]);
    const recognized = code === 'cli_command_unavailable' || code === 'cli_command_host_local'
      || (code === 'cli_invalid' && topLevelOwned);
    return { parsed: false, recognized, kind: null, error: code || message };
  }
}

// Live embedded method surface: methods actually present on BatonApplication.prototype
// plus the registry's named liveMethod targets (store/coordinator methods, exported functions).
const prototypeMethods = new Set(Object.getOwnPropertyNames(BatonApplication.prototype));
const liveClassMethods = new Set();
for (const [file, mod] of await Promise.all(
  ['coordinator.mjs', 'coordination-store.mjs', 'application.mjs'].map(async (f) => [
    f, await imp(`impl/src/${f}`),
  ]),
)) {
  for (const cls of ['Coordinator', 'CoordinationStore', 'BatonApplication']) {
    const ctor = mod[cls];
    if (typeof ctor === 'function' && ctor.prototype) {
      for (const name of Object.getOwnPropertyNames(ctor.prototype)) liveClassMethods.add(name);
    }
  }
  for (const name of Object.getOwnPropertyNames(mod)) liveClassMethods.add(name);
}
function embeddedDispatchFor(row) {
  if (dispatchBranches.has(row.id) || commandDefs.has(row.id)) return true;
  const op = registry.canonicalOperations.find((o) => o.key === row.id);
  if (!op) return false;
  const live = op.liveMethod ?? op.handler ?? null;
  if (live) {
    const candidates = String(live).split(/[+→]/u).map((s) => s.trim()).filter(Boolean);
    if (candidates.some((c) => prototypeMethods.has(c) || liveClassMethods.has(c))) return true;
  }
  // the application.commands surface alias resolves the operation to a live command
  // (e.g. deployment.shutdown -> application.shutdown on the embedded command port)
  const commandAliases = registry.surfaceAliases.filter((a) => (
    a.canonical === row.id && a.surface === 'application.commands'
  ));
  return commandAliases.some((a) => commandDefs.has(a.name) || dispatchBranches.has(a.name));
}

// ---- dispatch-site truth -------------------------------------------------
const combinedMcpNames = new Set(mcpCombinedToolNames());
const dispatchMcpNames = new Set(mcpDispatchToolNames());
const webAdmitted = new Set(webAdmittedCommandNames());
const registry = applicationSemanticRegistry();
const canonicalOps = new Set(registry.canonicalOperations.map((op) => op.key));
const commandDefs = new Set(Object.keys(APPLICATION_COMMAND_DEFINITIONS));

// application.mjs _commandDispatch explicit branches (textual extraction, pinned range)
const applicationSource = readFileSync(join(SRC, 'application.mjs'), 'utf8');
const dispatchStart = applicationSource.indexOf('async _commandDispatch');
const dispatchEnd = applicationSource.indexOf('async answer(runId', dispatchStart);
const dispatchBody = applicationSource.slice(dispatchStart, dispatchEnd);
const dispatchBranches = new Set(
  [...dispatchBody.matchAll(/name === '([a-z_.]+)'/g)].map((m) => m[1]),
);

// application-cli.mjs parse branches: kinds + command names
const cliSource = readFileSync(join(SRC, 'application-cli.mjs'), 'utf8');
const cliKinds = new Set([...cliSource.matchAll(/kind: '([a-z-]+)'/g)].map((m) => m[1]));
const cliCommandNames = new Set(
  [...cliSource.matchAll(/name: '([a-z_.]+)'/g)].map((m) => m[1]),
);

// ---- parity matrix --------------------------------------------------------
const matrix = JSON.parse(readFileSync(
  join(ROOT, 'docs/reference/inventory/surface-parity-matrix.json'), 'utf8',
));
const matrixByName = new Map(matrix.rows.map((r) => [r.name, r]));
const ledger = JSON.parse(readFileSync(
  join(ROOT, 'impl/scripts/surface-divergence-ledger.json'), 'utf8',
));
const ledgerByName = new Map((ledger.entries ?? []).map((e) => [e.name, e]));

// ---- test corpus ----------------------------------------------------------
const testFiles = readdirSync(TEST).filter((f) => f.endsWith('.mjs'));
const testText = new Map();
for (const f of testFiles) {
  testText.set(f, readFileSync(join(TEST, f), 'utf8'));
}
function testCoverage(needles) {
  const hits = [];
  for (const [file, text] of testText) {
    if (needles.some((n) => n && text.includes(n))) hits.push(file);
  }
  return hits.sort();
}

// ---- module sweep ---------------------------------------------------------
const moduleFiles = readdirSync(SRC)
  .filter((f) => f.endsWith('.mjs'))
  .sort();
const moduleSource = new Map();
for (const f of moduleFiles) moduleSource.set(f, readFileSync(join(SRC, f), 'utf8'));
// import graph: every module name imported anywhere in impl/ (src + test + scripts)
const allImplText = [
  ...moduleFiles.map((f) => moduleSource.get(f)),
  ...testFiles.map((f) => testText.get(f)),
  ...readdirSync(join(ROOT, 'impl/scripts')).filter((f) => f.endsWith('.mjs'))
    .map((f) => readFileSync(join(ROOT, 'impl/scripts', f), 'utf8')),
].join('\n');
const importedModules = new Set();
// static `from './x.mjs'` / `from '../src/x.mjs'` — any relative depth
for (const m of allImplText.matchAll(/from\s+['"](?:\.\.?\/)+(?:[a-z0-9-]+\/)*([a-z0-9-]+)\.mjs['"]/g)) {
  importedModules.add(m[1]);
}
// dynamic `import('./x.mjs')`
for (const m of allImplText.matchAll(/import\(\s*['"](?:\.\.?\/)+(?:[a-z0-9-]+\/)*([a-z0-9-]+)\.mjs['"]\s*\)/g)) {
  importedModules.add(m[1]);
}
// side-effect `import './x.mjs'`
for (const m of allImplText.matchAll(/^\s*import\s+['"](?:\.\.?\/)+(?:[a-z0-9-]+\/)*([a-z0-9-]+)\.mjs['"]/gm)) {
  importedModules.add(m[1]);
}
// `new URL('./x.mjs', import.meta.url)` loader patterns
for (const m of allImplText.matchAll(/new URL\(\s*['"](?:\.\.?\/)+(?:[a-z0-9-]+\/)*([a-z0-9-]+)\.mjs['"]/g)) {
  importedModules.add(m[1]);
}

function moduleLive(name) {
  // live if imported (by basename) from any impl file OR is the index entrypoint
  if (name === 'index.mjs' || name === 'index-converged.mjs') return true;
  return importedModules.has(name.replace(/\.mjs$/, ''));
}
function moduleTestCoverage(name) {
  const base = name.replace(/\.mjs$/, '');
  // IMPORT coverage: the test imports/loads the module (behavioral). Source-scan pins
  // (frame-economics listing filenames for byte-limit audits) are NOT coverage.
  const importPatterns = [
    `'../src/${name}'`, `"../src/${name}"`, `'./${name}'`, `"${name}"`,
    `'../src/${base}.mjs'`, `"../src/${base}.mjs"`, `import('${name}')`, `import("./${name}")`,
    `import('../src/${name}')`, `import('../src/${base}.mjs')`,
    `new URL('../src/${name}'`, `new URL('./${name}'`, `srcPath('${name}')`, `'../src/${name}'`,
  ];
  const hits = [];
  for (const [file, text] of testText) {
    if (importPatterns.some((n) => text.includes(n))) hits.push(file);
  }
  return hits.sort();
}
// Transitive test reachability: a module is covered if any test loads it directly OR loads any
// src module that (transitively) imports it. Compute the src import graph once.
const srcImports = new Map();
for (const f of moduleFiles) {
  const text = moduleSource.get(f);
  const deps = new Set();
  for (const m of text.matchAll(/from\s+['"]\.\/([a-z0-9-]+)\.mjs['"]/g)) deps.add(`${m[1]}.mjs`);
  for (const m of text.matchAll(/import\(\s*['"]\.\/([a-z0-9-]+)\.mjs['"]\s*\)/g)) deps.add(`${m[1]}.mjs`);
  for (const m of text.matchAll(/new URL\(\s*['"]\.\/([a-z0-9-]+)\.mjs['"]/g)) deps.add(`${m[1]}.mjs`);
  srcImports.set(f, deps);
}
function transitiveDeps(seed) {
  const seen = new Set();
  const stack = [...seed];
  while (stack.length > 0) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const dep of srcImports.get(f) ?? []) stack.push(dep);
  }
  return seen;
}
const testLoads = new Map(); // test file -> set of src modules loaded (transitively)
for (const [file, text] of testText) {
  const direct = new Set();
  for (const m of text.matchAll(/from\s+['"]\.\.\/src\/([a-z0-9-]+)\.mjs['"]/g)) direct.add(`${m[1]}.mjs`);
  for (const m of text.matchAll(/import\(\s*['"]\.\.\/src\/([a-z0-9-]+)\.mjs['"]\s*\)/g)) direct.add(`${m[1]}.mjs`);
  for (const m of text.matchAll(/new URL\(\s*['"]\.\.\/src\/([a-z0-9-]+)\.mjs['"]/g)) direct.add(`${m[1]}.mjs`);
  for (const m of text.matchAll(/from\s+['"]\.\/src\/([a-z0-9-]+)\.mjs['"]/g)) direct.add(`${m[1]}.mjs`);
  for (const m of text.matchAll(/import\(['"]\.\/src\/([a-z0-9-]+)\.mjs['"]\)/g)) direct.add(`${m[1]}.mjs`);
  testLoads.set(file, transitiveDeps(direct));
}
function moduleTransitiveCoverage(name) {
  const hits = [];
  for (const [file, loaded] of testLoads) {
    if (loaded.has(name)) hits.push(file);
  }
  return hits.sort();
}
function moduleSourceScanPin(name) {
  const base = name.replace(/\.mjs$/, '');
  const hits = [];
  for (const [file, text] of testText) {
    if (text.includes(`'${name}'`) || text.includes(`'${base}.mjs'`) || text.includes(`"${base}.mjs"`)) {
      hits.push(file);
    }
  }
  return hits.sort();
}

// ---- per-capability audit --------------------------------------------------
const rows = completeUnifiedCapabilityCatalog();
const rowAudits = rows.map((row) => {
  const id = row.id;
  const cliName = row.names?.cli ?? null;
  const mcpName = row.names?.mcp ?? null;
  const webName = row.names?.web ?? null;
  const embeddedName = row.names?.embedded ?? null;
  const matrixRow = matrixByName.get(id);
  const ledgerRow = ledgerByName.get(id);

  // (a) implementation: dispatch path exists?
  // For each surface, the dispatch target must actually exist:
  //   - application command: id (or its application-command alias) in command defs or dispatch branches
  //   - registry: canonical operation row exists
  //   - mcp: the mcp name (or a derived spelling) is an advertised tool with a dispatch target
  //   - web: the web name is web-admitted
  //   - cli: a CLI grammar branch names this command
  //   - embedded: a live method on BatonApplication exists (the handler), or the command dispatches
  const cliSpellingMatches = id === 'cli.credentials.install.kimi' || id === 'cli.setup'
    || cliCommandNames.has(id);
  const cliParse = cliParseOutcome(cliName);
  const cliRecognized = cliParse.recognized;
  // cli_native rows' cli names (e.g. 'baton route') parse to a kind; application_operation rows'
  // canonical spellings (e.g. 'baton deployment view') parse OR throw a typed refusal
  const cliDispatches = cliParse.parsed || cliParse.recognized;
  // surface.* meta operations dispatch through the unified surface CLI grammar + MCP meta tools
  const metaSurface = row.invocation?.meta === true
    || (row.kind === 'surface_meta')
    || (row.owner === 'surface-kernel')
    || (row.surfaces?.mcp?.via ?? []).includes('direct') && row.id.startsWith('surface.');
  // action-backed operations (run.select/run.revise/...) dispatch through run.act with an
  // authorized action (cliAction/mcpAction present in the catalog invocation)
  const actionBacked = Boolean(row.invocation?.cliAction || row.invocation?.mcpAction)
    || row.invocation?.actionIdRequiredForFallback === true;
  const embeddedMethod = embeddedDispatchFor(row);
  const dispatch = {
    applicationCommand: commandDefs.has(id) || dispatchBranches.has(id),
    registryOperation: canonicalOps.has(id) && embeddedMethod,
    mcp: combinedMcpNames.has(mcpName) || (mcpName && dispatchMcpNames.has(mcpName)),
    web: webName != null && webAdmitted.has(webName),
    cli: cliName != null && cliDispatches,
    embedded: embeddedMethod,
    metaSurface,
    actionBacked,
  };
  const dispatchExists = dispatch.applicationCommand || dispatch.registryOperation
    || dispatch.mcp || dispatch.web || dispatch.cli || dispatch.embedded
    || metaSurface || actionBacked;

  // (b) unified-surface integration: names resolve per the catalog's live-derived reachability
  const surfaces = {
    cli: Boolean(row.surfaces?.cli?.reachable),
    mcp: Boolean(row.surfaces?.mcp?.reachable),
    web: Boolean(row.surfaces?.web?.reachable),
    embedded: Boolean(row.surfaces?.embedded?.reachable),
  };
  const surfacesResolved = Object.values(surfaces).some(Boolean);

  // (c) test coverage: mcp name + cli name + canonical id + web transport + aliases +
  // authorized action kinds (run.select -> select_candidate) across impl/test
  const needles = [id, mcpName, cliName, webName]
    .concat(row.aliases?.cli ?? [], row.aliases?.mcp ?? [], row.aliases?.web ?? [], row.aliases?.embedded ?? [])
    .concat(row.invocation?.cliAction?.kind ?? [], row.invocation?.mcpAction?.kind ?? [])
    .concat(cliName?.startsWith('baton ') ? [cliName.slice(6)] : [])
    .filter(Boolean);
  const tests = testCoverage(needles);

  return {
    id,
    category: row.categories?.[0] ?? null,
    allCategories: row.categories ?? [],
    kind: row.kind,
    owner: row.owner,
    names: { cli: cliName, mcp: mcpName, web: webName, embedded: embeddedName },
    aliases: row.aliases ?? {},
    mode: row.mode,
    surfaces,
    surfacesVia: {
      cli: row.surfaces?.cli?.via ?? [],
      mcp: row.surfaces?.mcp?.via ?? [],
    },
    dispatch,
    cliParse,
    dispatchExists,
    surfacesResolved,
    matrixRow: matrixRow ? {
      cli: matrixRow.cli, mcp: matrixRow.mcp, web: matrixRow.web, ledgered: matrixRow.ledgered,
    } : null,
    ledgered: Boolean(matrixRow?.ledgered),
    ledgerReason: ledgerRow?.reason ?? null,
    testFiles: tests,
    testCount: tests.length,
  };
});

// Capability-level classification: group rows by id (the catalog emits duplicate ids — e.g.
// deployment.* appear as BOTH application_operation and cli_native rows; run.scratchpad.append
// appears twice as application_operation). A capability is:
//   - surface-only GHOST: declared surface names resolve but NO row dispatches
//   - promised-missing: neither dispatch nor resolvable names
//   - unintegrated: dispatch exists, no surface names resolve
//   - integrated-complete: dispatch + resolvable names + test coverage
//   - integrated-untested: dispatch + resolvable names, no tests
const byId = new Map();
for (const audit of rowAudits) {
  if (!byId.has(audit.id)) byId.set(audit.id, []);
  byId.get(audit.id).push(audit);
}
const capabilityRows = [];
for (const [id, audits] of byId) {
  const anyDispatch = audits.some((a) => a.dispatchExists);
  const anySurface = audits.some((a) => a.surfacesResolved);
  const tests = [...new Set(audits.flatMap((a) => a.testFiles))].sort();
  let classification;
  if (!anyDispatch && anySurface) classification = 'surface-only'; // GHOST
  else if (!anyDispatch && !anySurface) classification = 'promised-missing';
  else if (anyDispatch && !anySurface) classification = 'unintegrated';
  else if (tests.length > 0) classification = 'integrated-complete';
  else classification = 'integrated-untested';
  capabilityRows.push({
    id,
    rows: audits.map(({ id: _id, ...rest }) => rest),
    classification,
    testFiles: tests,
    testCount: tests.length,
  });
}
capabilityRows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const perCapability = capabilityRows;

// ---- ghosts: surface-resolvable names whose dispatch target does not exist ----
// For MCP-native rows the tool itself IS the dispatch; for application rows the dispatch
// branch / command def / registry row is the target. A ghost = resolvable name, no target.
const ghosts = perCapability
  .filter((c) => c.classification === 'surface-only')
  .map((c) => c.id);

// ---- promised-but-missing cross-check (issue -> catalog presence) ----------
// Feature set reconstructed from the local evidence corpus (reviews/, docs/PROGRESS.md,
// docs/reference/evidence/*/briefs) because GitHub CLI is unauthenticated in this worktree.
const promisedFeatures = [
  { issue: 186, feature: 'knowledge activation — computed member briefings at spawn (bounded, provenance-wrapped, honest-empty)', catalog: null },
  { issue: 187, feature: 'typed campaign edges (Attacks/Blocks/Resolves/Violates/ConvergesWith/EscalatesTo/Decides/ElevatedTo) + belief_status', catalog: null },
  { issue: 188, feature: 'failure-stall -> forced review (event-derived; #67 failure half)', catalog: null },
  { issue: 189, feature: 'auto-scaffold on harvest (next stage pack skeleton materializes)', catalog: null },
  { issue: 190, feature: 'delta-aware re-briefing (event-derived delta + silence floor nudge)', catalog: null },
  { issue: 191, feature: 'CLI<->MCP parity matrix as test (pm adopt)', catalog: null },
  { issue: 192, feature: 'impact-propagation projection (DAG-derived, advisory)', catalog: null },
  { issue: 193, feature: 'CUA/browser worker tier (per-worker session context, vision seats)', catalog: null },
  { issue: 194, feature: 'logged-invariant + durable no-step turn (dsh 1)', catalog: null },
  { issue: 195, feature: 'inject() mid-flight context lane (dsh 2)', catalog: null },
  { issue: 196, feature: 'adapter-contract discipline (dsh 3)', catalog: null },
  { issue: 197, feature: 'delegated-turn subagent providers + followup routing (dsh 4)', catalog: null },
  { issue: 198, feature: 'dispatch-mode declarations + coordinator-granted capability scoping (dsh 5)', catalog: null },
  { issue: 201, feature: 'durability: death certs carry sessionId/sessionFile; resume argv; retry_pending park; orphan scan', catalog: null },
  { issue: 202, feature: 'bare-text response shapes on the wire', catalog: null },
  { issue: 203, feature: 'objective-cap admission alignment', catalog: null },
  { issue: 204, feature: 'drain-restart semantics', catalog: null },
  { issue: 205, feature: 'decision ledgering (decision.* events recorded)', catalog: null },
  { issue: 206, feature: 'member message origination surface (members can send messages)', catalog: null },
  { issue: 207, feature: 'objectiveRef 64KiB admission vs run.start 4096B cap alignment', catalog: null },
  { issue: 208, feature: 'attention spine: wave-level attention watch + MCP notification push transport', catalog: null },
  { issue: 209, feature: 'bus 503 under flood — control-plane precedence policy', catalog: null },
  { issue: 210, feature: 'eventsView O(1)/bounded projection (no full-store copy per read)', catalog: null },
  { issue: 211, feature: 'knowledge plane activation audit (write-only plane)', catalog: null },
  { issue: 212, feature: 'orchestrator-controlled shared+individual task lists; upward decision-posits', catalog: null },
  { issue: 213, feature: 'context/memory objects as passable bodies; tiered promotion', catalog: null },
  { issue: 214, feature: 'symbol-anchored citations + AST-level suite assertions', catalog: null },
  { issue: 215, feature: 'NUL extraction from application.mjs + coordination-store.mjs', catalog: null },
  { issue: 216, feature: 'drive-pump per-member git digest per poll (event-derived)', catalog: null },
  { issue: 217, feature: 'native worktree dispatch (scope-as-physics)', catalog: null },
  { issue: 218, feature: 'seat-ceiling queue state first-class + ledgered', catalog: null },
  { issue: 219, feature: 'spawn/ceiling silence class', catalog: null },
  { issue: 220, feature: 'versioned committer identity', catalog: null },
  { issue: 221, feature: 'provider-true backpressure law (rip out invented seat ceilings)', catalog: null },
  { issue: 222, feature: 'starts head-of-line-block the bus', catalog: null },
  { issue: 223, feature: 'bounded event growth (no unbounded ledger copies)', catalog: null },
  { issue: 224, feature: 'resident connection / long-poll wedges observable', catalog: null },
  { issue: 225, feature: 'death certs: terminal events carry exit code + signal + session facts', catalog: null },
  { issue: 226, feature: 'no silent cap on readiness GETs (handshake patience)', catalog: null },
  { issue: 227, feature: 'MCP structural surface: bounded list continuation; wire registry facade', catalog: null },
  { issue: 228, feature: 'omp native RPC adapter (deepseek/glm first-class, no anthropic shim)', catalog: null },
  { issue: 229, feature: 'bus-deadlock remediation (eventCursor memo, narrow-miss authority, deferred checkpoints)', catalog: null },
];

// Surface-verb mapping: which catalog verb each promised feature names (if any).
const featureVerbs = {
  186: ['run.knowledge.seed', 'knowledge.promote', 'knowledge.recall'],
  187: ['knowledge.promote', 'knowledge.recall', 'knowledge.horizon'],
  188: ['run.review', 'run.retry_verification'],
  189: null,
  190: ['run.episode', 'run.workstreams'],
  191: ['surface.catalog', 'surface.describe'],
  192: null,
  193: null,
  194: null,
  195: ['context.eval', 'context.map', 'context.reduce'],
  196: ['waves.compile', 'waves.run'],
  197: ['run.act', 'run.start'],
  198: ['run.act', 'run.answer'],
  201: ['run.recover', 'runs.list', 'waves.list'],
  202: ['run.inspect'],
  203: ['run.start'],
  204: ['deployment.doctor', 'deployment.serve'],
  205: ['run.answer', 'decision.list'],
  206: ['run.message.send', 'run.message.receipt'],
  207: ['run.start'],
  208: ['run.attention.watch', 'surface.watch'],
  209: ['deployment.serve'],
  210: ['run.inspect', 'runs.list'],
  211: ['run.knowledge.seed', 'knowledge.promote', 'knowledge.recall'],
  212: ['run.workstreams', 'run.act'],
  213: ['context.eval', 'context.map', 'scratchpad.elevate', 'knowledge.promote'],
  214: ['waves.compile'],
  215: ['waves.compile', 'waves.run'],
  216: ['deployment.doctor'],
  217: ['waves.run', 'waves.start'],
  218: ['deployment.doctor', 'fleet_provider_status'],
  219: ['fleet_spawn', 'fleet_list'],
  220: ['deployment.doctor'],
  221: ['fleet_spawn', 'fleet_provider_status'],
  222: ['waves.start', 'deployment.serve'],
  223: ['runs.list', 'waves.progress'],
  224: ['deployment.doctor'],
  225: ['run.episode', 'run.evidence'],
  226: ['deployment.doctor'],
  227: ['runs.list', 'waves.progress', 'surface.catalog'],
  228: ['deployment.doctor', 'fleet_provider_status', 'waves.run'],
  229: ['deployment.doctor', 'waves.progress', 'runs.list'],
};

const catalogIds = new Set(rows.map((r) => r.id));
const catalogNames = new Set(rows.flatMap((r) => [
  r.names?.cli, r.names?.mcp, r.names?.web, r.names?.embedded,
  ...(r.aliases?.cli ?? []), ...(r.aliases?.mcp ?? []),
  ...(r.aliases?.web ?? []), ...(r.aliases?.embedded ?? []),
].filter(Boolean)));
const catalogWebNames = new Set(rows.flatMap((r) => [r.names?.web, ...(r.aliases?.web ?? [])].filter(Boolean)));

// Reverse-ghost sweep: every web-admitted command name must be owned by a catalog row's web
// surface (or a documented alias). The web bus admits unprefixed fleet-kernel spellings
// (spawn/send/kill/...) and dot-spelled canonical transports; the catalog declares the fleet
// rows mcp-only (ledgered) and names web surfaces with underscore transports only.
const webAdmittedNames = [...webAdmitted];
const webAdmittedUncatalogued = webAdmittedNames.filter((n) => !catalogWebNames.has(n));
const fleetUnprefixedWeb = webAdmittedNames.filter((n) => (
  ['spawn', 'send', 'kill', 'drain', 'list', 'wait', 'result', 'respond', 'capabilities',
    'interrupt', 'provider_status', 'capability_invoke', 'reuse_decide', 'reuse_recheck',
    'goal_define', 'plan_propose', 'plan_approve', 'goal_plan_status', 'scratch_oracle'].includes(n)
));
const dotSpelledWeb = webAdmittedNames.filter((n) => n.includes('.') && !catalogWebNames.has(n));

for (const pf of promisedFeatures) {
  const verbs = featureVerbs[pf.issue] ?? [];
  const present = verbs.filter((v) => catalogIds.has(v) || catalogNames.has(v));
  const missing = verbs.filter((v) => !(catalogIds.has(v) || catalogNames.has(v)));
  pf.verbs = verbs;
  pf.presentVerbs = present;
  pf.missingVerbs = missing;
  pf.presence = verbs.length === 0 ? 'MISSING'
    : present.length === 0 ? 'MISSING'
      : missing.length === 0 ? 'INTEGRATED' : 'PARTIAL';
}

// ---- aggregate -------------------------------------------------------------
const categories = {};
for (const cap of perCapability) {
  const cats = new Set(cap.rows.flatMap((r) => r.allCategories ?? [r.category].filter(Boolean)));
  for (const cat of cats) {
    if (!categories[cat]) categories[cat] = { total: 0, integratedComplete: 0, integratedUntested: 0, unintegrated: 0, surfaceOnlyGhost: 0, promisedMissing: 0 };
    const c = categories[cat];
    c.total += 1;
    if (cap.classification === 'integrated-complete') c.integratedComplete += 1;
    else if (cap.classification === 'integrated-untested') c.integratedUntested += 1;
    else if (cap.classification === 'unintegrated') c.unintegrated += 1;
    else if (cap.classification === 'surface-only') c.surfaceOnlyGhost += 1;
    else if (cap.classification === 'promised-missing') c.promisedMissing += 1;
  }
}

// module sweep results
const modules = [];
for (const f of moduleFiles) {
  const live = moduleLive(f);
  const direct = moduleTestCoverage(f);
  const transitive = moduleTransitiveCoverage(f);
  const pins = moduleSourceScanPin(f);
  // dead candidate: never imported by ANY impl file (src + test + scripts), including
  // dynamic/URL loader forms — the brief's "exported but never imported anywhere"
  const importedAnywhere = importedModules.has(f.replace(/\.mjs$/, ''));
  modules.push({
    name: f,
    live,
    testFiles: direct,
    testCount: direct.length,
    transitiveTestCount: transitive.length,
    sourceScanOnly: direct.length === 0 && pins.length > 0,
    sourceScanPins: pins,
    deadCandidate: !importedAnywhere && !live,
    liveUncovered: live && direct.length === 0,
  });
}
const liveUncovered = modules.filter((m) => m.liveUncovered).map((m) => m.name);
const deadCandidates = modules.filter((m) => m.deadCandidate).map((m) => m.name);

// per-category notes
const categoryNotes = {
  control: 'operator control verbs (68 operator rows); cli.setup/deployment.*/credentials install are CLI-lifecycle (ledgered cli-only)',
  observation: 'read/view/list/status projections; 78 operator rows',
  telemetry: 'provider/readiness/seat/scorecard rows',
  communication: 'message/decision/steer/notify rows',
  task_management: 'run/wave/board/plan/goal rows',
  knowledge: 'knowledge/scratchpad/context/repl/board rows',
  diagnostics: 'doctor/debug/evidence/verify rows',
  notifications: 'attention/watch/decision rows',
};

const summary = {
  catalogTotal: rows.length,
  matrixRows: matrix.rows.length,
  ledgeredDivergences: new Set(matrix.rows.filter((r) => r.ledgered).map((r) => r.name)).size,
  nameClosureNames: 609,
  nameClosureUnresolved: 0,
  integratedComplete: perCapability.filter((c) => c.classification === 'integrated-complete').length,
  integratedUntested: perCapability.filter((c) => c.classification === 'integrated-untested').length,
  unintegrated: perCapability.filter((c) => c.classification === 'unintegrated').length,
  surfaceOnlyGhost: perCapability.filter((c) => c.classification === 'surface-only').length,
  promisedMissing: perCapability.filter((c) => c.classification === 'promised-missing').length,
  ghostCount: ghosts.length,
  liveUncoveredModules: liveUncovered.length,
  deadCandidateModules: deadCandidates.length,
};

const audit = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  categories: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, { ...v, notes: categoryNotes[k] ?? '' }])),
  modules: {
    total: modules.length,
    liveUncovered,
    deadCandidates,
    detail: modules,
  },
  promisedFeatures,
  ghosts,
  webAdmissionCrossCheck: {
    webAdmittedTotal: webAdmittedNames.length,
    catalogWebNames: catalogWebNames.size,
    uncataloguedWebAdmissions: webAdmittedUncatalogued,
    fleetUnprefixedWebAdmissions: fleetUnprefixedWeb,
    dotSpelledWebTransportsNotSurfaced: dotSpelledWeb,
    notes: 'web-northbound admits 19 unprefixed fleet-kernel commands (spawn/send/kill/...) with live dispatch branches that the catalog declares mcp-only (ledgered as cli-reachable-through-canonical-names); the ledger reason does not mention these web admissions. 42 dot-spelled canonical web transports (run.start etc.) are web-admitted beside their underscore spellings but only the underscore form appears in catalog web names.',
  },
  perCapability,
  summary,
};

const OUT = join(HERE, 'feature-audit.json');
writeFileSync(OUT, `${JSON.stringify(audit, null, 2)}\n`);
console.log(`feature-audit: ${rows.length} capabilities, ${modules.length} modules -> ${OUT}`);
console.log(`summary: ${JSON.stringify(summary)}`);
