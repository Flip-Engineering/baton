// Doc-truth ⇄ admission conformance — red-first acceptance for the folded #159 contract
// (docs/reference/evidence/doc-truth-conformance-2026-08-13/contract-fold.md v1.1).
// Every acceptance pin R1–R11 becomes a row at its named stage; the two P-CS* rows are the
// substrate pins (the conformance main + the checked inventory artifact) that MUST stay green.
//
// [attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512 row-suite-159]
//
// Style: surface/conformance (control-surface-truth-red) — imports + source-region pins +
// parseBatonCli / instantiateProfileInventory probes + doc-file reads. R3/R9/R10 additionally
// exercise the MCP answer-shape and tool-admission tables through ONE minimal combined-surface
// McpFleetServer fixture (the CS-2 construction pattern) — no network, no host state.
//
// Split (verified at HEAD e371f70, measured twice — fold-suite-159.md):
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
import { McpFleetServer, mcpCombinedToolNames } from '../src/mcp-northbound.mjs';
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

// The seven wave MCP tools (G10) — R10 proves each documented example is executable against a real
// tool's admission table (required ⊆ keys ⊆ properties), not a repoId-first shape only.
const WAVE_TOOL_NAMES = new Set([
  'baton_waves_start', 'baton_waves_progress', 'baton_waves_send', 'baton_waves_stop',
  'baton_waves_list', 'baton_waves_run', 'baton_decision_answer',
]);

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

// R9 leg 1: the advertised answer branches of applicationAnswerSchema, in source order. The shared
// schema is read by baton_decision_answer AND fleet_run_answer (G10), so a retired branch would be
// advertised to both consumers. Structural extraction — a key rename (decision → resolution) is an
// extra advertised branch, exactly what the row forbids.
function advertisedAnswerKeys() {
  const src = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  const schema = sourceRegion(src, 'const applicationAnswerSchema = {', 'const applicationFeedbackFindingSchema');
  return [...schema.matchAll(/schema\(\{\s*([A-Za-z_][A-Za-z0-9_]*):/gu)].map((match) => match[1]);
}

// R11 leg 2: the parser's ACTUAL lifecycle dispatch set — the `const lifecycleActions = new Set(…)`
// literal PLUS any action special-cases wired before the shared gate (branch-added verbs are
// dispatchable; a count that reads only the literal misses them). The artifact's
// parserLifecycleActions count must match the dispatch, not a hand-maintained probe array.
function parserLifecycleDispatchCount() {
  const src = readFileSync(new URL('../src/application-cli.mjs', import.meta.url), 'utf8');
  const marker = 'const lifecycleActions = new Set(';
  const start = src.indexOf(marker);
  assert.ok(start >= 0, 'lifecycleActions literal present');
  const gate = src.indexOf('if (!lifecycleActions.has(action)) return parseStart', start);
  assert.ok(gate >= 0, 'lifecycle dispatch gate present');
  const region = src.slice(start, gate);
  const actions = new Set();
  const literalEnd = region.indexOf(');');
  for (const match of region.slice(marker.length, literalEnd).matchAll(/'([^']+)'/g)) {
    actions.add(match[1]);
  }
  for (const match of region.matchAll(/action\s*===\s*'([^']+)'/gu)) actions.add(match[1]);
  for (const match of region.matchAll(/\[([^\]]*)\]\.includes\(action\)/gu)) {
    for (const inner of match[1].matchAll(/'([^']+)'/gu)) actions.add(inner[1]);
  }
  return actions.size;
}

// One minimal combined-surface McpFleetServer for the answer-shape and tool-admission probes. The
// construction follows the CS-2 pattern (cli-dead-paths-red) — a stub facade listing the
// APPLICATION_COMMAND_DEFINITIONS keys satisfies the combined-surface card check; nothing here
// touches the network or host state, and the principal validity window is a fixed far-future date
// (no clock as a control). The fleet_run_answer tool lives on the combined surface only.
let _answerServer = null;
function combinedMcpServer() {
  if (_answerServer === null) {
    const commands = Object.keys(APPLICATION_COMMAND_DEFINITIONS);
    _answerServer = new McpFleetServer({
      coordinator: {
        list: () => [],
        card: () => ({}),
        capability: () => null,
      },
      coordination: {
        admitMcpCall: async () => ({ status: 'admitted' }),
        completeMcpCall: async () => {},
        failMcpCall: async () => {},
        mcpCall: () => null,
        recordMcpAudit: () => {},
      },
      application: {
        repoId: 'repo-a',
        card: () => ({ repoId: 'repo-a', commands }),
        command: async () => ({ ok: true }),
        authorizeReplay: async () => true,
      },
      principal: {
        userId: 'op', sessionId: 's',
        capabilities: ['observe', 'control', 'approve'],
        repoIds: ['repo-a'],
        expiresAt: '2099-01-01T00:00:00.000Z',
        revoked: false,
      },
      shutdownPrincipal: {
        actor: 'mcp-host', principalId: 'host', sessionId: 's',
      },
      repoIds: ['repo-a'],
      surface: 'combined',
      maxMessageBytes: 64 * 1024,
      takeToolQuota: () => ({ ok: true }),
    });
  }
  return _answerServer;
}

// The refusal code validateArguments emits for a tools/call frame, or null when validation passes
// (the dispatch result is intentionally not inspected — a passing shape may still be refused
// downstream by the coordinator, which is outside this suite's fixture). Drives the server through
// the initialize handshake once, then the tools/call envelope.
async function mcpToolRefusalCode(name, args) {
  const server = combinedMcpServer();
  if (server._ready !== true) {
    await server.handle({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'probe', version: '0.0.1' },
      },
    });
    await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
    server._ready = true;
  }
  const out = await server.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args },
  });
  return out?.result?.structuredContent?.error?.code ?? out?.error?.code ?? null;
}

// ── R1 (D1 CLI closure 1): documented-but-unparsed is a conformance finding ──────────────────────

test('R1 (run-watch-documented-but-unparsed): run.watch is served AND its example compiles to the run.watch command on two fixtures', () => {
  const keys = servedCliOrdinaryKeys();
  assert.ok(keys.includes('run.watch'), 'R1: run.watch is a served CLI row (documented)');
  const operation = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.find((o) => o.key === 'run.watch');
  assert.ok(operation, 'R1: run.watch has a canonical operation row');
  // Two-fixture discipline: a parser special-case on the fixture RUN_ID (run:r1) fails on a real
  // second RUN_ID, and the produced name must be a REGISTERED canonical operation — a synthetic
  // parser special-case name (never wired through the registry) fails.
  for (const runId of ['run:r1', 'run:z9']) {
    let parsed;
    try {
      parsed = parseBatonCli(['run', 'watch', runId]);
    } catch (error) {
      assert.fail(`R1 (run-watch-documented-but-unparsed): run watch ${runId} must compile, threw ${error.code}: ${error.message}`);
    }
    const key = parseResultToKey(parsed);
    assert.equal(canon(key), canon('run.watch'),
      `R1 (run-watch-documented-but-unparsed): run watch ${runId} → ${key}, expected run.watch`);
    assert.ok(APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.some((row) => row.key === key),
      `R1: parsed name ${key} must be a registered canonical operation, not a synthetic special-case`);
  }
});

// ── R2 (D1 web leg / G7): the web.bus inventory equals the card's advertised set ────────────────

test('R2 (web-bus-inventory-undercount): web.bus inventory equals the card AND derives from the D1 admission accessor', () => {
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
  // D2 single-source law: webBusNames() must DERIVE from the D1 webBusAdmittedCommandNames()
  // accessor (the card's admission source), not from a hand-written literal — a hardcoded
  // 31-name literal or an append of the six wave verbs fails this source pin.
  const conformanceSrc = readFileSync(new URL('../scripts/surface-conformance.mjs', import.meta.url), 'utf8');
  const body = sourceRegion(conformanceSrc, 'function webBusNames() {', 'export function instantiateProfileInventory');
  assert.ok(/webBusAdmittedCommandNames/u.test(body),
    'R2 (web-bus-inventory-undercount): webBusNames() must reference the D1 webBusAdmittedCommandNames() accessor');
});

// ── R3 (D3 #5): no refused answer form is accepted by the answer pipeline ───────────────────────

test('R3 (answer-schema-advertises-decision): a renamed/refused answer form is refused with invalid_arguments on both consumers', async () => {
  // Behavioral closure: the guard (shared accepted-answer-keys set ['optionId','text']) must
  // refuse a renamed form ({resolution}) on the second consumer — a schema-only rename or a
  // permissive guard leaves the renamed form accepted (or refused by the wrong, non-guard path).
  const code = await mcpToolRefusalCode('fleet_run_answer', {
    repoId: 'repo-a',
    idempotencyKey: 'ik-1',
    runId: 'run-a',
    requestId: 'req-1',
    answer: { resolution: { id: 'd-1', outcome: 'approved' } },
  });
  assert.equal(code, 'invalid_arguments',
    `R3 (answer-schema-advertises-decision): a refused answer form must be refused by the answer-shape guard (invalid_arguments), got ${code}`);
});

// ── R4 (G4 / silent-reinterpretation law): run watch compiles, bare run watch never reinterprets ─

test('R4 (run-watch-silent-reinterpretation): run watch RUN_ID → run.watch on two fixtures; bare run watch refuses value-required', () => {
  for (const runId of ['run:r1', 'run:z9']) {
    let parsed;
    try {
      parsed = parseBatonCli(['run', 'watch', runId]);
    } catch (error) {
      assert.fail(`R4 (run-watch-silent-reinterpretation): run watch ${runId} must compile, threw ${error.code}: ${error.message}`);
    }
    assert.equal(canon(parseResultToKey(parsed)), canon('run.watch'),
      `R4: run watch ${runId} → ${parseResultToKey(parsed)}, expected run.watch`);
  }
  // The bare form must refuse with the value-required shape (runId missing) — NOT silently
  // reinterpret to run.start, and NOT a "refusing spelling" (unserved verb).
  let bare;
  try {
    bare = parseBatonCli(['run', 'watch']);
  } catch (error) {
    assert.equal(error?.code, 'cli_invalid',
      'R4: bare run watch must refuse at parse with cli_invalid (value-required)');
    assert.match(String(error?.message ?? ''), /run id|runId|required/iu,
      'R4: bare run watch refusal must be the runId value-required shape');
    return;
  }
  assert.fail(`R4 (run-watch-silent-reinterpretation): bare run watch must refuse value-required, compiled to ${JSON.stringify(bare)}`);
});

// ── R5 (D4 leg): every served row's Example AND taught Verb columns stay shape-green ────────────

test('R5 (cli-example-shape-leg-red): every served row compiles its Example AND taught Verb, and the served set is honest', () => {
  const served = servedCliOrdinaryKeys();
  // Anti-drop law: a served-keys filter that drops the refusing rows (application.help verb,
  // run.watch example) would green the example/verb legs — the dropped rows must stay served.
  for (const mustServe of ['application.help', 'run.watch']) {
    assert.ok(served.includes(mustServe), `R5: ${mustServe} must remain a served CLI row`);
  }
  // Containment law: every served row resolves into the CLI web whitelist ∪ the web card (via the
  // alias map). run.debug is host-local and run.send is a semantic-action CLI verb — neither is a
  // web-served row, so both are legitimately outside the whitelist.
  const whitelist = new Set([...CLI_WEB_COMMANDS, ...WEB_BUS_DOT_NAMES_31]);
  for (const key of served) {
    if (key === 'run.debug' || key === 'run.send') continue;
    assert.ok(whitelist.has(key) || whitelist.has(canon(key)),
      `R5: served row ${key} is neither whitelisted nor card-admitted`);
  }
  const failures = [];
  for (const key of served) {
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
  // Two-fixture discipline for the run.watch example (a parser special-case on the fixture RUN_ID
  // must not green the example leg).
  let watchParsed;
  try {
    watchParsed = parseBatonCli(['run', 'watch', 'run:z9']);
  } catch (error) {
    failures.push(`run.watch: run watch run:z9 threw ${error.code}: ${error.message}`);
  }
  if (watchParsed) {
    const key = parseResultToKey(watchParsed);
    if (canon(key) !== canon('run.watch')) failures.push(`run.watch: run watch run:z9 parsed to ${key}`);
  }
  assert.deepEqual(failures, [],
    `R5 (cli-example-shape-leg-red): example-shape leg must be green — ${failures.join(' | ')}`);
});

// ── R6 (D3 #2): no live run steer claim in CLI.md ──────────────────────────────────────────────

test('R6 (cli-run-steer-prose-live): CLI.md teaches no run steer command (any spelling)', () => {
  const cliDoc = readFileSync(new URL('../CLI.md', import.meta.url), 'utf8');
  assert.ok(!/\brun[\s.]*steer\b/gu.test(cliDoc),
    'R6 (cli-run-steer-prose-live): CLI.md must not claim run steer remains live (run steer / run.steer / run  steer)');
  assert.ok(!/steer\b[^.\n]*remains an advanced/gu.test(cliDoc),
    'R6 (cli-run-steer-prose-live): the "remains an advanced compatibility surface" claim is retired');
});

// ── R7 (D3 #3): every whitelisted CLI name is web-admitted or ledgered ─────────────────────────

test('R7 (facade-ports-unledgered): every CLI_WEB_COMMANDS name is web-admitted or ledgered, and ledger rows are full shape', () => {
  const card = new Set(WEB_BUS_DOT_NAMES_31);
  const ledger = JSON.parse(readFileSync(new URL('../scripts/surface-divergence-ledger.json', import.meta.url), 'utf8'));
  assert.equal(ledger.schemaVersion, 1, 'R7: the divergence ledger declares schemaVersion 1');
  assert.ok(Array.isArray(ledger.entries), 'R7: the divergence ledger carries an entries array');
  // Shape law — a ledger row is not name-presence: it records the validateLedger fields
  // (surface/name/dimension/retiresIn/canonical) AND names the divergence it documents. Name-only
  // entries (the cheapest wrong impl) fail here.
  for (const entry of ledger.entries) {
    assert.ok(typeof entry.surface === 'string' && entry.surface.length > 0, 'R7: ledger row carries a surface');
    assert.ok(typeof entry.name === 'string' && entry.name.length > 0, 'R7: ledger row carries a name');
    assert.ok(typeof entry.dimension === 'string' && entry.dimension.length > 0, 'R7: ledger row carries a dimension');
    assert.ok(entry.retiresIn !== undefined && entry.retiresIn !== null, 'R7: ledger row carries retiresIn');
    assert.ok('canonical' in entry, 'R7: ledger row carries a canonical target');
    const divergence = entry.reason ?? entry.refusal ?? entry.note;
    assert.ok(typeof divergence === 'string' && divergence.length > 0,
      'R7: ledger row documents a non-empty divergence (naming the web refusal)');
  }
  const ledgerNames = new Set(ledger.entries.map((entry) => entry.name));
  // Forward direction: every whitelisted CLI name is web-admitted or ledgered.
  const unledgered = [];
  for (const name of CLI_WEB_COMMANDS) {
    const resolved = applicationOperationAliasMap()[name] ?? name;
    if (card.has(name) || card.has(resolved)) continue; // web-admitted (canonical or legacy spelling)
    if (ledgerNames.has(name) || ledgerNames.has(resolved)) continue; // ledgered
    unledgered.push(name);
  }
  assert.deepEqual(unledgered, [],
    `R7 (facade-ports-unledgered): unledgered whitelisted-but-web-refused names — ${unledgered.join(', ')}`);
  // Stale-ledger direction: no ledger row for a web-admitted name (a row for an admitted name is
  // stale — the name belongs in the admission, not the divergence ledger).
  const stale = [];
  for (const entry of ledger.entries) {
    const resolved = applicationOperationAliasMap()[entry.name] ?? entry.name;
    if (card.has(entry.name) || card.has(resolved)) stale.push(entry.name);
  }
  assert.deepEqual(stale, [],
    `R7 (facade-ports-unledgered): ledgered names that are web-admitted — ${stale.join(', ')}`);
});

// ── R8 (D3 #4): the MCP initialize instruction names only existing tools ───────────────────────

test('R8 (initialize-context-briefing-unmet): the initialize briefing names no non-MCP command', () => {
  const src = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  const briefing = sourceRegion(src, 'const briefingSentence', 'return protocolResult(id, {');
  // Template interpolations are data, not tool names; the sentence itself is a template literal, so
  // single-word backtick tokens (e.g. `baton_context_eval`) and lowercase dotted command spellings
  // (e.g. context.briefing) are the name-carrying shapes.
  const sentences = briefing.replace(/\$\{[^}]*\}/gu, '');
  const allowlist = new Set(mcpCombinedToolNames());
  const named = new Set();
  for (const match of sentences.matchAll(/`([A-Za-z_][A-Za-z0-9_.-]*)`/gu)) named.add(match[1]);
  for (const match of sentences.matchAll(/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\b/gu)) named.add(match[0]);
  const phantom = [...named].filter((name) => !allowlist.has(name));
  assert.deepEqual(phantom, [],
    `R8 (initialize-context-briefing-unmet): the briefing names non-MCP tools — ${phantom.join(', ')}`);
});

// ── R9 (D3 #5): no decision branch in the schema AND the answer-shape guard covers both consumers ─

test('R9 (fleet-run-answer-accepts-decision): the answer schema is decision-free AND the guard covers fleet_run_answer', async () => {
  const failures = [];
  // Leg 1 — the schema advertises exactly the closed answer set (no retired branch, under any
  // rename). Structural extraction defeats the rename dodge: a renamed branch is still an extra
  // advertised form.
  const advertised = advertisedAnswerKeys();
  if (advertised.slice().sort().join(',') !== ['optionId', 'text'].join(',')) {
    failures.push(`schema advertises [${advertised.join(', ')}], expected exactly [optionId, text]`);
  }
  // Leg 2 — a decision-shaped answer on fleet_run_answer is refused by the answer-shape guard with
  // invalid_arguments. Behavioral: a comment plant or a dead guard branch changes nothing, so the
  // decision answer still reaches dispatch (or is refused by the wrong, non-guard path).
  const code = await mcpToolRefusalCode('fleet_run_answer', {
    repoId: 'repo-a',
    idempotencyKey: 'ik-1',
    runId: 'run-a',
    requestId: 'req-1',
    answer: { decision: { id: 'd-1', outcome: 'approved' } },
  });
  if (code !== 'invalid_arguments') {
    failures.push(`fleet_run_answer accepted a decision answer (guard refusal ${code}, expected invalid_arguments)`);
  }
  assert.deepEqual(failures, [],
    `R9 (fleet-run-answer-accepts-decision): ${failures.join(' | ')}`);
});

// ── R10 (D3 #6 / D4 MCP leg): MCP.md wave examples are fenced json blocks that are executable ───

test('R10 (mcp-wave-examples-omit-repoId): Orchestrate-a-wave examples are fenced json blocks naming real tools with executable shapes', () => {
  const mcpDoc = readFileSync(new URL('../MCP.md', import.meta.url), 'utf8');
  const start = mcpDoc.indexOf('## Orchestrate a wave');
  assert.ok(start >= 0, 'R10: Orchestrate-a-wave section exists');
  const rest = mcpDoc.slice(start);
  const next = rest.indexOf('\n## ', 2);
  const section = next >= 0 ? rest.slice(0, next) : rest;
  const fenced = [...section.matchAll(/```json\n([\s\S]*?)```/gu)];
  assert.ok(fenced.length > 0,
    'R10 (mcp-wave-examples-omit-repoId): the wave examples must be fenced json blocks');
  // Tool-name law: every backtick-named wave tool in the section is a real MCP tool — a fenced
  // example naming a nonexistent tool fails here.
  const allowlist = new Set(mcpCombinedToolNames());
  const backticked = [...section.matchAll(/`(baton_waves_[a-z_]+|baton_decision_answer)`/gu)]
    .map((match) => match[1]);
  for (const name of backticked) {
    assert.ok(allowlist.has(name), `R10: section names ${name}, which is not an MCP tool`);
  }
  // Admission law — each fenced example is an executable shape: it carries a tool-specific field
  // (a repoId-only block is not an executable wave example) AND is admitted by at least one real
  // wave tool (required ⊆ keys ⊆ properties from the tool's actual inputSchema). An example the
  // admission refuses fails here.
  const waveTools = combinedMcpServer().toolDefinitions.filter((tool) => WAVE_TOOL_NAMES.has(tool.name));
  assert.equal(waveTools.length, WAVE_TOOL_NAMES.size, 'R10: every wave tool is on the combined surface');
  const unadmitted = [];
  for (const [, body] of fenced) {
    const shape = JSON.parse(body);
    assert.ok('repoId' in shape, 'R10: each wave example carries repoId');
    assert.equal(Object.keys(shape)[0], 'repoId', 'R10: repoId comes first');
    const keys = Object.keys(shape);
    if (!keys.some((key) => key !== 'repoId' && key !== 'idempotencyKey')) {
      unadmitted.push(`${JSON.stringify(shape)}: no tool-specific field`);
      continue;
    }
    const admitted = waveTools.some((tool) => {
      const { required, properties } = tool.inputSchema;
      return required.every((key) => keys.includes(key)) && keys.every((key) => key in properties);
    });
    if (!admitted) unadmitted.push(`${JSON.stringify(shape)}: refused by every wave tool admission`);
  }
  assert.deepEqual(unadmitted, [],
    `R10 (mcp-wave-examples-omit-repoId): unadmitted wave example shapes — ${unadmitted.join(' | ')}`);
});

// ── R11 (D2 + D1 CLI leg + regen): the committed artifact carries the admission and compile-set ─

test('R11 (artifact-counts-stale): committed artifact counts match the admission and the parser dispatch', () => {
  const failures = [];
  const artifact = JSON.parse(readFileSync(new URL('../scripts/surface-inventory-artifact.json', import.meta.url), 'utf8'));
  // Leg 1 — webBusCommands ties to the R2 card derivation (the 31-name admission), not a separate
  // count.
  const card = new Set([
    ...Object.entries(APPLICATION_COMMAND_DEFINITIONS).filter(([, d]) => d.web).map(([name]) => name),
    ...WAVE_WEB_VERBS,
  ]);
  if (artifact.counts.webBusCommands !== card.size) {
    failures.push(`webBusCommands ${artifact.counts.webBusCommands} ≠ card admission ${card.size}`);
  }
  // Leg 2 — parserLifecycleActions ties to the parser's lifecycle dispatch set (literal + branch
  // special-cases), not a hand-maintained probe array.
  const dispatchCount = parserLifecycleDispatchCount();
  if (artifact.counts.parserLifecycleActions !== dispatchCount) {
    failures.push(`parserLifecycleActions ${artifact.counts.parserLifecycleActions} ≠ parser dispatch ${dispatchCount}`);
  }
  assert.deepEqual(failures, [],
    `R11 (artifact-counts-stale): ${failures.join(' | ')}`);
});

// ── substrate pins (must stay GREEN at HEAD) ───────────────────────────────────────────────────

test('P-CS1-b: node impl/scripts/surface-conformance.mjs has an executable main that is green', () => {
  const result = execFileSync(process.execPath, [conformanceScript], {
    cwd: repoRoot,
    encoding: 'utf8',
    // watchdog.stallMs — the conformance gate must finish far inside 60 s; this is the suite's
    // hermetic stall ceiling, not a wall-clock control.
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
