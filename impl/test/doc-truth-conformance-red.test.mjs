// Doc-truth ⇄ admission conformance — red-first acceptance for the folded #159 contract
// (docs/reference/evidence/doc-truth-conformance-2026-08-13/contract-fold.md v1.1).
// Every acceptance pin R1–R11 becomes a row at its named stage; the two P-CS* rows are the
// substrate pins (the conformance main + the checked inventory artifact) that MUST stay green.
//
// [attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512 row-suite-159]
//
// Style: surface/conformance (control-surface-truth-red) — imports + source-region pins +
// parseBatonCli / instantiateProfileInventory probes + doc-file reads. The contract's domain is
// the conformance gate + admission tables + docs, so no heavy host fixtures are needed.
//
// Split (verified at HEAD e371f70, measured twice — see suite-draft-notes.md):
//   13 tests · 11 fail at their named stages (R1–R11) · 2 pass (P-CS1-b, P-CS4).
//
// Invented behavior (post-contract) is asserted BEHAVIORALLY or via source-region pins — a missing
// implementation is a red assertion, never a load-time crash from importing an absent export.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { CLI_WEB_COMMANDS, parseBatonCli } from '../src/application-cli.mjs';
import { APPLICATION_SEMANTIC_REGISTRY, applicationOperationAliasMap } from '../src/application-semantics.mjs';
import { buildSurfaceInventoryArtifact, checkSurfaceInventoryArtifact, instantiateProfileInventory } from '../scripts/surface-conformance.mjs';
import { servedCliOrdinaryKeys } from '../scripts/render-surface-docs.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const conformanceScript = fileURLToPath(
  new URL('../scripts/surface-conformance.mjs', import.meta.url),
);

// ── pinned ground truth: the card-advertised web.bus admission (31 dot names, ACTUAL order) ─────
const WEB_BUS_DOT_NAMES_31 = [
  'application.help',
  'run.act',
  'run.adopt',
  'run.answer',
  'run.approve',
  'run.episode',
  'run.evidence',
  'run.export',
  'run.feedback',
  'run.follow',
  'run.inspect',
  'run.integrate',
  'run.recover',
  'run.resume_work',
  'run.retry_verification',
  'run.review',
  'run.start',
  'run.status',
  'run.stop',
  'run.wait',
  'run.workstream.notify',
  'run.workstream.stop',
  'run.workstreams',
  'runs.list',
  'waves.attach',
  'waves.list',
  'waves.progress',
  'waves.run',
  'waves.send',
  'waves.start',
  'waves.stop',
];

// The six web wave direct ports (web-northbound.mjs:37-47) — the D2 admission must equal
// (web-admitted APPLICATION_COMMAND_DEFINITIONS names) ∪ (these wave verbs).
const WAVE_WEB_VERBS = ['waves.start', 'waves.progress', 'waves.send', 'waves.stop', 'waves.list', 'waves.run'];

// The eight facade ports (application-cli.mjs:29-31) — whitelisted for the CLI, refused on the
// web surface, unledgered at HEAD (R7).
const FACADE_PORTS = [
  'run.message.send',
  'run.message.receipt',
  'run.attention.watch',
  'run.scratchpad.read',
  'run.scratchpad.elevate',
  'run.board.post',
  'run.board.read',
  'run.knowledge.seed',
];

// ── helpers ────────────────────────────────────────────────────────────────────────────────────

// D4 fixture substitution: placeholders in the registry example strings are replaced with values
// the parser actually admits (a bare "RUN_ID" is a value, not a shape probe).
const FIXTURES = Object.freeze({
  RUN_ID: 'run:r1',
  R: 'probe',
  REASON: 'probe',
  TEXT: 'hello',
  DIGEST: 'ab'.repeat(32),
  ACTION_ID: 'act-1',
  BOARD: 'b1',
  DIR: 'out',
  MESSAGE_ID: `message:${'a'.repeat(64)}`,
  TASK_ID: 't1',
  JSON: '[]',
  WAVE_ID: 'wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ROLE: 'alpha',
  REQUEST_ID: 'req-1',
});

function shellTokens(text) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

function substitutedArgv(example) {
  return shellTokens(example)
    .filter((token, i) => !(i === 0 && token === 'baton'))
    .map((token) => FIXTURES[token] ?? token);
}

// D4 alias/kind normalization: the parse result → the row's operation key.
//   {kind:'command', name}          → the parsed command name (a canonical or legacy spelling)
//   {kind:'semantic-action', ...}    → run.<actionKind>
//   {kind:'adopt'|'export'|...}      → run.<kind>
function parseResultToKey(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.kind === 'command') return result.name ?? null;
  if (result.kind === 'semantic-action') return `run.${result.actionKind}`;
  if (typeof result.kind === 'string') return `run.${result.kind}`;
  return null;
}

// Canonical resolution through the application.commands alias map (legacy → canonical). The
// example may parse to a legacy spelling (e.g. `run.watch` → canonical `run.follow`); both sides
// of R5 are resolved through the SAME map.
function canon(name) {
  if (!name) return null;
  return applicationOperationAliasMap()[name] ?? name;
}

// Refusing spelling (R5 verb-column law): a taught verb that refuses outright — either the
// cli_command_unavailable code or the parseStart "expected X, …, or Y" refusal. Value-required
// errors ("Run ID is invalid", "--members is required", …) are correct bare-verb behavior, not a
// shape failure; the silent-reinterpretation half is pinned separately at R4 for run watch.
function isRefusingSpelling(error) {
  return error?.code === 'cli_command_unavailable'
    || (error?.code === 'cli_invalid' && /expected [a-z ,]+ or [a-z]+/u.test(error?.message ?? ''));
}

// Source-region pin helper. All pinned sources are NUL-clean (import/read-safe); the NUL-bearing
// application.mjs / coordination-store.mjs are never whole-file read here.
function sourceRegion(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.ok(start >= 0, `source region start marker missing: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(end >= 0, `source region end marker missing: ${endMarker}`);
  return text.slice(start, end);
}

function lifecycleActionsSourceCount() {
  const src = readFileSync(new URL('../src/application-cli.mjs', import.meta.url), 'utf8');
  const marker = 'const lifecycleActions = new Set(';
  const start = src.indexOf(marker);
  assert.ok(start >= 0, 'lifecycleActions literal present');
  const end = src.indexOf(');', start + marker.length);
  const literal = src.slice(start + marker.length, end);
  return [...literal.matchAll(/'([^']+)'/g)].length;
}

// ── R1 (D1 CLI closure 1): documented-but-unparsed is a conformance finding ──────────────────────

test('R1 (run-watch-documented-but-unparsed): run.watch is served AND its example compiles to the run.watch command', () => {
  const keys = servedCliOrdinaryKeys();
  assert.ok(keys.includes('run.watch'), 'R1: run.watch is a served CLI row (documented)');
  const operation = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.find((o) => o.key === 'run.watch');
  assert.ok(operation, 'R1: run.watch has a canonical operation row');
  let parsed;
  try {
    parsed = parseBatonCli(substitutedArgv(operation.example));
  } catch (error) {
    assert.fail(`R1 (run-watch-documented-but-unparsed): ${operation.example} must compile, threw ${error.code}: ${error.message}`);
  }
  const key = parseResultToKey(parsed);
  assert.equal(canon(key), canon('run.watch'),
    `R1 (run-watch-documented-but-unparsed): ${operation.example} → ${key}, expected run.watch`);
});

// ── R2 (D1 web leg / G7): the web.bus inventory equals the card's advertised set ────────────────

test('R2 (web-bus-inventory-undercount): web.bus inventory equals the card-advertised 31 dot names', () => {
  // The card's advertised set — the web-admitted application command names ∪ the wave direct ports
  // (the `application.commands` names the card spreads at web-northbound.mjs:1521).
  const card = [
    ...Object.entries(APPLICATION_COMMAND_DEFINITIONS).filter(([, d]) => d.web).map(([name]) => name),
    ...WAVE_WEB_VERBS,
  ].sort();
  assert.deepEqual(card, WEB_BUS_DOT_NAMES_31, 'R2: the card projection matches the pinned 31');
  const inventory = instantiateProfileInventory('web.bus');
  assert.deepEqual(inventory.names, WEB_BUS_DOT_NAMES_31,
    `R2 (web-bus-inventory-undercount): web.bus inventory (${inventory.names.length}) must equal the 31-name card`);
});

// ── R3 (D3 #5): the MCP answer schema advertises no decision form ──────────────────────────────

test('R3 (answer-schema-advertises-decision): applicationAnswerSchema carries no decision branch', () => {
  const src = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  const schema = sourceRegion(src, 'const applicationAnswerSchema = {', 'const applicationFeedbackSchema = {');
  assert.ok(!/\bdecision\b/u.test(schema),
    'R3 (answer-schema-advertises-decision): the schema must not advertise a decision form');
  assert.ok(/optionId/u.test(schema) && /text/u.test(schema), 'R3: the optionId/text forms survive');
});

// ── R4 (G4 / silent-reinterpretation law): run watch compiles, bare run watch never reinterprets ─

test('R4 (run-watch-silent-reinterpretation): run watch RUN_ID → run.watch; bare run watch ≠ run.start', () => {
  let parsed;
  try {
    parsed = parseBatonCli(['run', 'watch', 'run:r1']);
  } catch (error) {
    assert.fail(`R4 (run-watch-silent-reinterpretation): run watch RUN_ID must compile, threw ${error.code}: ${error.message}`);
  }
  assert.equal(canon(parseResultToKey(parsed)), canon('run.watch'),
    `R4: run watch RUN_ID → ${parseResultToKey(parsed)}, expected run.watch`);
  let bare;
  try {
    bare = parseBatonCli(['run', 'watch']);
  } catch {
    return; // a refusal is a valid green; the law is violated only by a silent reinterpretation
  }
  assert.notEqual(parseResultToKey(bare), 'run.start',
    'R4 (run-watch-silent-reinterpretation): bare run watch must not silently compile to run.start');
});

// ── R5 (D4 leg): every served row's Example AND taught Verb columns stay shape-green ────────────

test('R5 (cli-example-shape-leg-red): every served row compiles its Example AND taught Verb (fixture substitution + alias/kind normalization)', () => {
  const failures = [];
  for (const key of servedCliOrdinaryKeys()) {
    const operation = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.find((o) => o.key === key);
    // Example column — the D4 fixture-substituted shape must reach the row's canonical operation.
    try {
      const parsedKey = parseResultToKey(parseBatonCli(substitutedArgv(operation.example)));
      if (canon(parsedKey) !== canon(key)) failures.push(`${key}: example parsed to ${parsedKey}`);
    } catch (error) {
      failures.push(`${key}: example threw ${error.code}: ${error.message}`);
    }
    // Verb column — the taught verb must never be a refusing spelling (a shape failure, not a
    // value-required throw: bare verbs without required args are expected to refuse on value).
    const verbArgv = shellTokens(operation.names.cli)
      .filter((token, i) => !(i === 0 && token === 'baton'));
    try {
      parseBatonCli(verbArgv);
    } catch (error) {
      if (isRefusingSpelling(error)) {
        failures.push(`${key}: taught verb ${operation.names.cli} refuses: ${error.message}`);
      }
    }
  }
  assert.deepEqual(failures, [],
    `R5 (cli-example-shape-leg-red): example-shape leg must be green — ${failures.join(' | ')}`);
});

// ── R6 (D3 #2): no live run steer claim in CLI.md ──────────────────────────────────────────────

test('R6 (cli-run-steer-prose-live): CLI.md teaches no run steer command', () => {
  const cliDoc = readFileSync(new URL('../CLI.md', import.meta.url), 'utf8');
  assert.ok(!/\brun steer\b/u.test(cliDoc),
    'R6 (cli-run-steer-prose-live): CLI.md must not claim run steer remains live');
});

// ── R7 (D3 #3): every whitelisted CLI name is web-admitted or ledgered ─────────────────────────

test('R7 (facade-ports-unledgered): every CLI_WEB_COMMANDS name is web-admitted or ledgered', () => {
  const card = new Set(WEB_BUS_DOT_NAMES_31);
  const ledger = JSON.parse(readFileSync(new URL('../scripts/surface-divergence-ledger.json', import.meta.url), 'utf8'));
  const ledgerNames = new Set(ledger.entries.map((entry) => entry.name));
  const unledgered = [];
  for (const name of CLI_WEB_COMMANDS) {
    const resolved = applicationOperationAliasMap()[name] ?? name;
    if (card.has(name) || card.has(resolved)) continue; // web-admitted (canonical or legacy spelling)
    if (ledgerNames.has(name) || ledgerNames.has(resolved)) continue; // ledgered
    unledgered.push(name);
  }
  assert.deepEqual(unledgered, [],
    `R7 (facade-ports-unledgered): unledgered whitelisted-but-web-refused names — ${unledgered.join(', ')}`);
});

// ── R8 (D3 #4): the MCP initialize instruction names only existing tools ───────────────────────

test('R8 (initialize-context-briefing-unmet): the initialize briefing names no non-MCP command', () => {
  const src = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  const briefing = sourceRegion(src, 'const briefingSentence', 'return protocolResult(id, {');
  assert.ok(!/context\.briefing/u.test(briefing),
    'R8 (initialize-context-briefing-unmet): context.briefing has no MCP tool — the sentence must not promise it');
});

// ── R9 (D3 #5): no decision branch in the schema AND the answer-shape guard covers both consumers ─

test('R9 (fleet-run-answer-accepts-decision): the answer schema is decision-free and the guard covers fleet_run_answer', () => {
  const src = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  const schema = sourceRegion(src, 'const applicationAnswerSchema = {', 'const applicationFeedbackSchema = {');
  assert.ok(!/\bdecision\b/u.test(schema),
    'R9 (fleet-run-answer-accepts-decision): applicationAnswerSchema must not carry a decision branch');
  const guard = sourceRegion(src, "if (name === 'baton_decision_answer')", "if (name === 'fleet_capability_invoke')");
  assert.ok(/fleet_run_answer/u.test(guard),
    'R9 (fleet-run-answer-accepts-decision): the shared answer-shape guard must also cover fleet_run_answer');
});

// ── R10 (D3 #6 / D4 MCP leg): MCP.md wave examples are fenced json blocks with repoId first ────

test('R10 (mcp-wave-examples-omit-repoId): Orchestrate-a-wave examples are fenced json blocks carrying repoId first', () => {
  const mcpDoc = readFileSync(new URL('../MCP.md', import.meta.url), 'utf8');
  const start = mcpDoc.indexOf('## Orchestrate a wave');
  assert.ok(start >= 0, 'R10: Orchestrate-a-wave section exists');
  const rest = mcpDoc.slice(start);
  const next = rest.indexOf('\n## ', 2);
  const section = next >= 0 ? rest.slice(0, next) : rest;
  const fenced = [...section.matchAll(/```json\n([\s\S]*?)```/gu)];
  assert.ok(fenced.length > 0,
    'R10 (mcp-wave-examples-omit-repoId): the wave examples must be fenced json blocks');
  for (const [, body] of fenced) {
    const shape = JSON.parse(body);
    assert.ok('repoId' in shape, 'R10: each wave example carries repoId');
    assert.equal(Object.keys(shape)[0], 'repoId', 'R10: repoId comes first');
  }
});

// ── R11 (D2 + D1 CLI leg + regen): the committed artifact carries the admission and compile-set ─

test('R11 (artifact-counts-stale): committed artifact counts match the admission and the parser compile-set', () => {
  const artifact = JSON.parse(readFileSync(new URL('../scripts/surface-inventory-artifact.json', import.meta.url), 'utf8'));
  assert.equal(artifact.counts.webBusCommands, WEB_BUS_DOT_NAMES_31.length,
    'R11 (artifact-counts-stale): webBusCommands must equal the 31-name admission');
  const parserCompileSet = lifecycleActionsSourceCount();
  assert.equal(artifact.counts.parserLifecycleActions, parserCompileSet,
    'R11 (artifact-counts-stale): parserLifecycleActions must equal the parser compile-set');
});

// ── substrate pins (must stay GREEN at HEAD) ───────────────────────────────────────────────────

test('P-CS1-b: node impl/scripts/surface-conformance.mjs has an executable main that is green', () => {
  const result = execFileSync(process.execPath, [conformanceScript], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(String(result), /surface-conformance: ok/u);
});

test('P-CS4: the checked inventory artifact regenerates deterministically and checks clean', () => {
  const first = buildSurfaceInventoryArtifact();
  const second = buildSurfaceInventoryArtifact();
  assert.equal(JSON.stringify(first), JSON.stringify(second),
    'P-CS4: artifact must be byte-stable across two builds');
  assert.deepEqual(checkSurfaceInventoryArtifact(), []);
  assert.equal(typeof first.counts.webBusCommands, 'number');
  assert.equal(typeof first.counts.parserLifecycleActions, 'number');
});
