// #157 red-first suite — CLI wave ghosts + interpreter-wave registry fidelity.
// Authority: docs/reference/evidence/cli-wave-fidelity-2026-08-13/
//   contract-fold.md (v1.1 — source of truth, red-first acceptance pins A7-1..A7-8),
//   contract-redteam.md (the attack surface), contract-fold-brief.md, redteam-157-brief.md,
//   contract-foundry-2026-08-13/foundry-brief.md (the suite law).
// [attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512]
//
// Sixteen rows: 8 RED capability rows (A7-1..A7-8, one per contract acceptance pin, each at its
// NAMED stage) + 8 PIN rows (A2-4, A2-5, A5-1..A5-5, A6-6 — the contract's "must stay green" D2
// boundary + parity rows). Every RED row fails for its named stage at HEAD and goes green only for
// a contract-correct D1/D2/D3 implementation; every PIN row is green at HEAD and under the correct
// implementation but fails a plausible WRONG one (the pin list below names the wrong impl each kills).
// Fixture idiom mirrors wave-observability-red.test.mjs (openHost = real createDriver +
// BatonApplication + bindBaton, markerAdapter, driverEvents) and control-surface-truth-red.test.mjs
// (the conformance/doc rows import the renderer + registry directly).
//
// NUL-byte discipline: the two NUL files are never read whole — application.mjs is touched only
// through the imported BatonApplication export, coordination-store.mjs only via recordDriver
// (never readFileSync). web-northbound.mjs is NUL-free and is read whole for the A7-7 transport
// pin. This suite file contains 0 NUL bytes.
//
// No clocks: the fixture never constructs a Date — the driver/application run on their own
// internal state; every assertion rides run/view shapes, never wall-clock. localeCompare is never
// used; sorted-key literals below are in ACTUAL sorted order.
//
// ===========================================================================
// ROW INVENTORY (the stage is the HEAD failure seam, named per row; the split at
// the bottom was measured against the PRE-implementation tree)
// ===========================================================================
//
// §A Red capability rows (D1/D2/D3 acceptance pins A7-1..A7-8)
//   A7-1  parse — `baton waves send run:foo --message hi` parses to { command: 'waves.send',
//         args: { runId, message: 'hi' } }. (RED — cli_command_unavailable at HEAD)
//   A7-2  parse — `--now` → args.delivery 'now'; two delivery flags refuse
//         cli_action_inputs_invalid (mirror run send, application-cli.mjs:1733-1738). (RED)
//   A7-3  parse — `baton waves stop run:foo --reason done` parses to { command: 'waves.stop',
//         args: { runId, reason } }; a missing --reason refuses cli_action_inputs_invalid. (RED)
//   A7-4  admit — CLI_WEB_COMMANDS contains waves.send AND waves.stop (else BatonWebClient.command
//         refuses at application-cli.mjs:2013). (RED — neither is admitted at HEAD)
//   A7-5  doc — render-surface-docs.mjs --check passes AND the committed CLI.md cli-verb-inventory
//         region contains both rows. (RED — ghost rows absent at HEAD; N7 sequencing: green only
//         after D1.2(2)+(4) land together)
//   A7-6  D3 closed-set — every waves.* canonical op claiming the cli surface is admitted
//         (CLI_WEB_COMMANDS), parses to { name: <key> } under its per-verb minimal invocation
//         (D3.3/N6), and is documented in the CLI.md generated block. (RED — send/stop fail all three)
//   A7-7  dispatch leg — the parsed send/stop names map through name.replaceAll('.', '_') to
//         waves_send/waves_stop ∈ WAVE_WEB_ENTRIES (web-northbound.mjs:40-41) and the full
//         parse → dispatch → transport round-trip reaches sendWaveMember/stopWaveMember. (RED at
//         the parse leg at HEAD)
//   A7-8  D2 — an interpreter-wave member (createWave string roster, wave.mjs:180) renders
//         phase/progressClass/attentionCount in waves list identical to a driver-wave member driven
//         to the same state (N4 — drive both to a phase-bearing state, never assert non-nullness).
//         (RED — the string branch hardcodes nulls, application.mjs:11785)
//
// §B PIN rows (green at HEAD, must stay green — the D2 boundary and the parity rows)
//   B-1  A2-4 F6/F13 — a legacy string-array roster with NO steering record survives a store
//         close/reopen replay and renders the pinned no-run read (route/scope null, liveness
//         'local', nulls, no error key). Kills an impl that hydrates run-less string members or
//         drops the no-run branch.
//   B-2  A2-5 — a malformed NEW-shape roster still refuses wave_registry_invalid via the poisoned
//         projection. Kills an impl that loosens the B2 gate.
//   B-3  A5-1 — `baton waves list` parses to waves.list. Kills an impl whose D1.2(3) closed-set
//         rewrite breaks the existing plural verbs.
//   B-4  A5-2 — `baton waves progress WAVE_ID` parses to waves.progress. Kills the same.
//   B-5  A5-3 — singular `wave` refuses cli_command_unavailable with the plural corrective naming
//         the RIGHT verb. Kills an impl that touches the singular corrective.
//   B-6  A5-4 — a bare `baton waves attach` issues waves.list, never the wave-ID-invalid refusal.
//         Kills the same.
//   B-7  A5-5 F11 — the issued bare-attach shape runs the full parse→dispatch→render pipeline and
//         surfaces the attachable set. Kills an impl that breaks the pipeline.
//   B-8  A6-6 F4 — `baton waves start --members JSON` drives an admission-exceeding objective
//         through the full CLI pipeline to a typed wave_member_invalid. Kills an impl that breaks
//         the waves.start branch.
//
// ===========================================================================
// VERIFIED SPLIT (measured against the PRE-implementation tree; run twice)
// ===========================================================================
//   PASS 8 · FAIL 8 — stable across two runs from the repo root
//   (split recorded in suite-draft-notes.md)

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MockAdapter } from '../src/adapter.mjs';
import { BatonApplication } from '../src/application.mjs';
import { CLI_WEB_COMMANDS, parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { renderCliVerbInventory } from '../scripts/render-surface-docs.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const renderDocsScript = fileURLToPath(
  new URL('../scripts/render-surface-docs.mjs', import.meta.url),
);
const REPO_ID = 'repo-wave-157';
// limits.mjs:85 — spill.body, the ONE substrate ceiling that mints a hard refusal. An objective
// beyond it is the B-8 (A6-6) admission refusal that FIRES at HEAD.
const SPILL_BODY_CEILING = 1_048_576;
const BIG_OBJECTIVE = 'x'.repeat(SPILL_BODY_CEILING + 1);
const WAVE_ID = 'wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RUN_ID = 'run:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// ── hermetic fixture (wave-observability-red.test.mjs idiom) ────────────────

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-157-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', [
    '-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base',
  ], { cwd: dir });
  return dir;
}

function principal(id) {
  return Object.freeze({
    actor: 'test', principalId: id, sessionId: `session-${id}`,
  });
}

// The markerAdapter card override is required for exact-route admission (the run.start lane checks
// the deployment card's modelSelection before admitting the member route).
function markerAdapter() {
  const adapter = new MockAdapter({ scenario: { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'cli-wave-fidelity-157', refreshedAt: null,
    },
  });
  return adapter;
}

function createDriverFor(repo, logDir, adapter) {
  return createDriver({
    repoRoot: repo,
    repoId: REPO_ID,
    logDir,
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1,
        repoId: REPO_ID,
        mandatory: true,
        approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low', 'medium', 'high', 'critical'],
        effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
}

function buildApplication(driver) {
  return new BatonApplication({
    driver,
    repoId: REPO_ID,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1,
        repoId: REPO_ID,
        definitionOfDone: ['deployment verification passes'],
        constraints: [],
        risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
}

function openHost(repo, logDir, adapter) {
  const driver = createDriverFor(repo, logDir, adapter);
  const application = buildApplication(driver);
  const baton = bindBaton(application, principal('wave-owner'));
  return { application, baton, driver };
}

async function hostFixture(t) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const host = openHost(repo, logDir, markerAdapter());
  host.repo = repo;
  host.logDir = logDir;
  host.owner = principal('wave-owner');
  t.after(async () => {
    await host.application.shutdown(principal('cleanup')).catch(() => {});
    try { host.driver.coordination.releaseWriterLease(); } catch { /* shutdown may have released it */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return host;
}

// Facade member shape (embedded surface, the createWave string-roster lane): top-level
// harness/model/effort — wave.mjs:180 mints the role-only roster from it.
const facadeMember = (role, objective) => ({
  role,
  objective,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'],
  report: `reports/${role}.md`,
});

// Direct-port member shape (waves.start / waves_attach): the closed `exact` route object.
const memberExact = (role, objective) => ({
  role, objective, exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
  scope: ['reports/**'],
});

function driverEvents(driver, kind, waveId = null) {
  return driver.coordination.events().filter((event) => (
    event.kind === 'driver.recorded' && event.payload?.kind === kind
    && (waveId === null || event.payload?.waveId === waveId)
  ));
}

// A routing client in the exact bindBaton shape (application-client.mjs:1652) — the 3rd arg
// runBatonCli passes is the idempotency key, so the port stays two-argument like the shipped client.
function cliRoutingClient(host) {
  return { command: async (name, args) => host.application.command(name, args, principal('wave-owner')) };
}

// ── doc/source helpers ──────────────────────────────────────────────────────

// The committed CLI.md cli-verb-inventory generated region (the INDEPENDENT documented side of the
// D3.2 invariant — it must never derive from CLI_WEB_COMMANDS on both sides).
function cliVerbInventoryBlock() {
  const cliMd = readFileSync(fileURLToPath(new URL('../CLI.md', import.meta.url)), 'utf8');
  const begin = cliMd.indexOf('<!-- BEGIN GENERATED: cli-verb-inventory');
  const end = cliMd.indexOf('<!-- END GENERATED: cli-verb-inventory -->');
  assert.ok(begin !== -1 && end !== -1 && begin < end, 'the generated region is present in CLI.md');
  return cliMd.slice(begin, end);
}

// The closed-set waves.* ordinary verbs, derived MECHANICALLY from the registry — never a hand
// list (D3.3). At HEAD this is exactly attach/start/progress/send/stop/list/run.
function wavesCliOrdinaryKeys() {
  return APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .filter((op) => op.surfaces?.includes('cli') && op.key.startsWith('waves.'))
    .map((op) => op.key);
}

// Per-verb MINIMAL valid invocation, built per the D3.3/N6 construction rule: a required positional
// id rides argv positionally (runId for send/stop, waveId for attach/progress, specPath for run);
// each remaining schema-required field rides a flag (--message TEXT, --reason TEXT, --members []
// empty-minimum); a verb whose schema requires nothing (waves.list) is bare.
function minimalWaveCliInvocation(key) {
  switch (key) {
    case 'waves.attach': return ['waves', 'attach', WAVE_ID, '--members', '[]'];
    case 'waves.start': return ['waves', 'start', '--members', '[]'];
    case 'waves.progress': return ['waves', 'progress', WAVE_ID];
    case 'waves.send': return ['waves', 'send', RUN_ID, '--message', 'hi'];
    case 'waves.stop': return ['waves', 'stop', RUN_ID, '--reason', 'done'];
    case 'waves.list': return ['waves', 'list'];
    case 'waves.run': return ['waves', 'run', 'spec.json'];
    default: throw new Error(`no CLI minimal invocation pinned for ${key}`);
  }
}

// ===========================================================================
// §A — the A7 red rows (one per contract acceptance pin)
// ===========================================================================

test('A7-1 (parse): `baton waves send run:foo --message hi` parses to { command: \'waves.send\', args: { runId, message: \'hi\' } }', () => {
  let parsed = null;
  try {
    parsed = parseBatonCli(['waves', 'send', 'run:foo', '--message', 'hi']);
  } catch { /* HEAD: cli_command_unavailable; parsed stays null */ }
  assert.ok(parsed !== null,
    'stage: cli-wave-verbs-missing — at HEAD parseBatonCli throws cli_command_unavailable (application-cli.mjs:1383-1384 — the closed set handles run|list|progress|start|attach only); D1.2(1) parses the schema-shaped waves.send');
  assert.equal(parsed.kind, 'command', 'the compiled shape is an ordinary command');
  assert.equal(parsed.command, 'waves.send', 'the command field names the canonical key');
  assert.equal(parsed.name, 'waves.send', 'the dispatch name is the canonical key');
  assert.equal(parsed.args.runId, 'run:foo', 'runId rides positionally (id() helper, application-cli.mjs:100-103)');
  assert.equal(parsed.args.message, 'hi', '--message TEXT rides the flag (mirror --members, application-cli.mjs:1363-1365)');
});

test('A7-2 (parse): `baton waves send ... --now` carries args.delivery \'now\'; two delivery flags refuse cli_action_inputs_invalid', () => {
  let parsed = null;
  try {
    parsed = parseBatonCli(['waves', 'send', 'run:foo', '--message', 'hi', '--now']);
  } catch { /* HEAD: cli_command_unavailable */ }
  assert.ok(parsed !== null,
    'stage: cli-wave-verbs-missing — at HEAD parseBatonCli throws cli_command_unavailable; D1.2(1) copies the run send delivery-mode take (application-cli.mjs:1733-1738)');
  assert.equal(parsed.args.delivery, 'now', '--now maps to delivery \'now\'');
  // The negative leg — at most one delivery mode (bounded modes, refuse when modes.length > 1).
  assert.throws(
    () => parseBatonCli(['waves', 'send', 'run:foo', '--message', 'hi', '--now', '--turn']),
    (error) => {
      assert.equal(error.code, 'cli_action_inputs_invalid',
        'two delivery flags refuse cli_action_inputs_invalid (the refusal-vocabulary row for the new send branch, contract §Refusal vocabulary)');
      return true;
    },
  );
});

test('A7-3 (parse): `baton waves stop run:foo --reason done` parses to { command: \'waves.stop\', args: { runId, reason } }; a missing --reason refuses cli_action_inputs_invalid', () => {
  let parsed = null;
  try {
    parsed = parseBatonCli(['waves', 'stop', 'run:foo', '--reason', 'done']);
  } catch { /* HEAD: cli_command_unavailable */ }
  assert.ok(parsed !== null,
    'stage: cli-wave-verbs-missing — at HEAD parseBatonCli throws cli_command_unavailable; D1.2(1) parses the schema-shaped waves.stop');
  assert.equal(parsed.command, 'waves.stop', 'the command field names the canonical key');
  assert.equal(parsed.name, 'waves.stop', 'the dispatch name is the canonical key');
  assert.equal(parsed.args.runId, 'run:foo', 'runId rides positionally');
  assert.equal(parsed.args.reason, 'done', '--reason TEXT rides the flag');
  assert.throws(
    () => parseBatonCli(['waves', 'stop', 'run:foo']),
    (error) => {
      assert.equal(error.code, 'cli_action_inputs_invalid',
        'OQ1 — the CLI requires --reason (matching the dispatcher at application.mjs:11900/11967-11968), refusing early cli_action_inputs_invalid, never a server refusal');
      return true;
    },
  );
});

test('A7-4 (admit): CLI_WEB_COMMANDS contains waves.send AND waves.stop', () => {
  assert.ok(CLI_WEB_COMMANDS.has('waves.send'),
    'stage: cli-wave-whitelist-missing — at HEAD CLI_WEB_COMMANDS (application-cli.mjs:16-32) carries waves.attach/start/list/progress/run but NOT waves.send; D1.2(2) admits it, else BatonWebClient.command refuses at application-cli.mjs:2013');
  assert.ok(CLI_WEB_COMMANDS.has('waves.stop'),
    'stage: cli-wave-whitelist-missing — waves.stop is likewise absent at HEAD; D1.2(2) admits it');
});

test('A7-5 (doc): render-surface-docs.mjs --check passes AND the committed CLI.md cli-verb-inventory region contains both ghost rows', () => {
  // The drift gate is green at HEAD (servedCliOrdinaryKeys and the docs derive from the SAME
  // whitelist, so the ghost is invisible to both sides — contract D3.1). N7 sequencing: green only
  // after D1.2(2) whitelist admission AND D1.2(4) doc regeneration land in ONE change set.
  const check = execFileSync(process.execPath, [renderDocsScript, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(String(check).trim(), '', 'the --check gate passes (exits 0) — the regenerated block matches the renderer');
  const block = cliVerbInventoryBlock();
  assert.ok(block.includes('| `waves.send` |'),
    'stage: cli-wave-doc-row-missing — at HEAD the generated block lists attach/list/progress/run/start only (CLI.md:52-56); D1.2(4) regenerates the waves.send row, and the --check gate stays green only when the whitelist admission lands in the same change set (N7)');
  assert.ok(block.includes('| `waves.stop` |'),
    'stage: cli-wave-doc-row-missing — the waves.stop row is likewise absent at HEAD; D1.2(4) regenerates it');
  assert.match(renderCliVerbInventory(), /`waves\.send`/u, 'the renderer emits the waves.send row once admitted');
  assert.match(renderCliVerbInventory(), /`waves\.stop`/u, 'the renderer emits the waves.stop row once admitted');
});

test('A7-6 (D3 closed-set): every waves.* cli-claiming op is admitted, parses to { name: <key> }, and is documented — the ghost-prevention pin', () => {
  const closedSet = wavesCliOrdinaryKeys();
  assert.ok(closedSet.length >= 7,
    'the closed set is derived mechanically from APPLICATION_SEMANTIC_REGISTRY (D3.3) — at HEAD attach/start/progress/send/stop/list/run');
  const block = cliVerbInventoryBlock();
  for (const key of closedSet) {
    assert.ok(CLI_WEB_COMMANDS.has(key),
      `stage: ghost-prevention-pin-missing — ${key} claims the cli surface (surfaces.includes('cli')) but is not admitted in CLI_WEB_COMMANDS (application-cli.mjs:16-32); D3.3 requires whitelist membership for every wave-lane cli claim`);
    let parsed = null;
    try {
      parsed = parseBatonCli(minimalWaveCliInvocation(key));
    } catch { /* RED at HEAD: send/stop throw cli_command_unavailable */ }
    assert.ok(parsed !== null && parsed.kind === 'command' && parsed.name === key,
      `stage: ghost-prevention-pin-missing — ${key} does not parse into { name: ${key} } under its D3.3/N6 minimal invocation; D1.2(1) adds the two parse branches`);
    assert.ok(block.includes(`| \`${key}\` |`),
      `stage: ghost-prevention-pin-missing — ${key} is not documented in the CLI.md cli-verb-inventory region; D1.2(4) regenerates the rows`);
  }
});

test('A7-7 (dispatch leg): parsed send/stop map to waves_send/waves_stop ∈ WAVE_WEB_ENTRIES and the full parse → dispatch → transport round-trip reaches sendWaveMember/stopWaveMember', async (t) => {
  const host = await hostFixture(t);
  const wave = await host.application.command('waves.start', {
    idempotencyKey: 'a7-7', members: [memberExact('alpha', 'write the alpha report')],
  }, principal('wave-owner'));
  const runId = wave.members[0].runId;
  assert.ok(runId, 'the fixture member run is real');

  // (1) Parse — RED at HEAD.
  let sendParsed = null;
  try {
    sendParsed = parseBatonCli(['waves', 'send', runId, '--message', 'nudge']);
  } catch { /* HEAD: cli_command_unavailable */ }
  assert.ok(sendParsed !== null,
    'stage: cli-wave-verbs-missing — at HEAD parseBatonCli throws cli_command_unavailable, so the dispatch leg cannot run; D1.2(1) parses waves.send');

  // (2) The admit seam: the parsed name maps through name.replaceAll(\'.\', \'_\') into the web
  // transport (application-cli.mjs:2015 → web-northbound.mjs:40-41).
  assert.equal(sendParsed.name.replaceAll('.', '_'), 'waves_send',
    'the parsed waves.send name maps to the waves_send transport');
  const stopParsed = parseBatonCli(['waves', 'stop', runId, '--reason', 'done']);
  assert.equal(stopParsed.name.replaceAll('.', '_'), 'waves_stop',
    'the parsed waves.stop name maps to the waves_stop transport');

  // (3) The transport entries PRE-EXIST (web-northbound.mjs:37-47) — the D3.2 invariant leg (3)
  // rides them; the source region is NUL-free and read whole for this pin.
  const webSrc = readFileSync(fileURLToPath(new URL('../src/web-northbound.mjs', import.meta.url)), 'utf8');
  const waveEntries = webSrc.slice(
    webSrc.indexOf('const WAVE_WEB_ENTRIES'),
    webSrc.indexOf('const WAVE_ARG_FIELDS'),
  );
  assert.match(waveEntries, /\[\s*'waves_send'/u, 'WAVE_WEB_ENTRIES carries the waves_send transport (web-northbound.mjs:40)');
  assert.match(waveEntries, /\[\s*'waves_stop'/u, 'WAVE_WEB_ENTRIES carries the waves_stop transport (web-northbound.mjs:41)');

  // (4) The full parse → dispatch → transport round-trip: send reaches sendWaveMember (the
  // undispatched member resolves the POST-dispatch application_worker_not_found, never a
  // pre-admission cli_command_unavailable), and stop reaches stopWaveMember and resolves ok.
  await assert.rejects(
    runBatonCli(sendParsed, cliRoutingClient(host)),
    (error) => {
      assert.equal(error.code, 'application_worker_not_found',
        'the round-trip reached sendWaveMember (application.mjs:11840-11893) — the fixture member run is undispatched, so the dispatch surfaces the post-dispatch typed code');
      return true;
    },
  );
  const stopped = await runBatonCli(stopParsed, cliRoutingClient(host));
  assert.ok(stopped !== null && typeof stopped === 'object' && stopped.runId === runId,
    'the stop round-trip reached stopWaveMember (application.mjs:11895-11902) and resolved the member run');
});

test('A7-8 (D2): an interpreter-wave member renders phase/progressClass/attentionCount identical to a driver-wave member driven to the same state', async (t) => {
  const host = await hostFixture(t);
  // Interpreter lane (the createWave string-roster seam, wave.mjs:180): the facade waves.start
  // mints a role-only string roster and starts each member run, which IS steering-registered
  // (application.mjs:4654-4667). approve:false keeps the member awaiting_plan_approval — the SAME
  // phase-bearing state the direct-port driver member reaches.
  const interp = await host.baton.waves.start({
    repoRoot: host.repo,
    idempotencyKey: 'a7-8-interp',
    members: [facadeMember('alpha', 'write the alpha report')],
    approve: false,
  });
  assert.equal(driverEvents(host.driver, 'steering.registered', interp.waveId).length, 1,
    'the interpreter member is steering-registered — the D2 hydration read is not vacuous');
  // Driver lane (the object-roster direct port): startWave mints [{role, route, scope}] and starts
  // the member run awaiting_plan_approval.
  const driver = await host.application.command('waves.start', {
    idempotencyKey: 'a7-8-driver', members: [memberExact('alpha', 'write the alpha report')],
  }, principal('wave-owner'));

  const listed = await host.application.command('waves.list', {}, principal('wave-owner'));
  const interpRow = listed.waves.find((w) => w.waveId === interp.waveId);
  const driverRow = listed.waves.find((w) => w.waveId === driver.waveId);
  assert.ok(interpRow && driverRow, 'both waves list as open rows');
  const interpMember = interpRow.roster.find((m) => m.role === 'alpha');
  const driverMember = driverRow.roster.find((m) => m.role === 'alpha');
  assert.ok(interpMember && driverMember, 'both alpha members render');
  assert.ok(driverMember.phase !== null && driverMember.progressClass !== null,
    'the driver member is driven to a phase-bearing state (awaiting_plan_approval) — the comparison is non-vacuous (N4)');
  assert.equal(interpMember.phase, driverMember.phase,
    'stage: interpreter-phase-null — at HEAD the string branch hardcodes phase:null (application.mjs:11785) while the object branch reads the live run; D2.3 hydrates the string branch from inspect (application.mjs:11806-11808)');
  assert.equal(interpMember.progressClass?.class ?? null, driverMember.progressClass?.class ?? null,
    'the progress class reads identically — the law renders view?.progressClass ?? view?.outline?.progressClass ?? null (application.mjs:11807)');
  assert.equal(interpMember.attentionCount, driverMember.attentionCount,
    'the attention count reads identically — the law renders Array.isArray(view?.attention) ? view.attention.length : 0 (application.mjs:11802)');
});

// ===========================================================================
// §B — the D2-boundary + parity PIN rows (green at HEAD, must stay green)
// ===========================================================================

test('B-1 PIN (A2-4 F6/F13): a legacy string-array roster survives a store close/reopen replay and renders the pinned no-run read', async (t) => {
  const host = await hostFixture(t);
  const legacyWaveId = `wave:${createHash('sha256').update('legacy-157-pin').digest('hex').slice(0, 32)}`;
  const recorded = host.driver.coordination.recordDriver('wave.started', {
    waveId: legacyWaveId, roster: ['alpha', 'beta'], idempotencyKey: 'legacy-157-ik',
  }, { actor: 'test', key: `wave.started:${legacyWaveId}` });
  assert.equal(recorded.ok, true,
    'the legacy append is accepted — the B2 gate shape-checks BEFORE strictness and never refuses a well-formed legacy string-array roster');

  // F6 — prove the registry fold by a store close/reopen REPLAY, not a live append.
  await host.application.shutdown(principal('cleanup')).catch(() => {});
  try { host.driver.coordination.releaseWriterLease(); } catch { /* shutdown may have released it */ }
  const reopenedDriver = createDriverFor(host.repo, host.logDir, markerAdapter());
  const reopenedApp = buildApplication(reopenedDriver);
  const reopened = {
    application: reopenedApp, driver: reopenedDriver, repo: host.repo, logDir: host.logDir,
  };
  t.after(async () => {
    await reopenedApp.shutdown(principal('cleanup')).catch(() => {});
    try { reopenedDriver.coordination.releaseWriterLease(); } catch {}
  });

  const listed = await reopened.application.command('waves.list', {}, principal('wave-owner'));
  const row = listed.waves.find((w) => w.waveId === legacyWaveId);
  assert.ok(row, 'the legacy row survives the reopen');
  assert.deepEqual(row.roster.map((m) => m.role), ['alpha', 'beta']);
  for (const m of row.roster) {
    // D2.4 — the no-run member read is pinned VERBATIM: a run-less legacy member renders liveness
    // local with nulls and NEVER refuses wave_not_found (the D5.2 seam only fires for a member
    // whose run was registered and then disappeared).
    assert.equal(m.route, null, 'D2.4 — a legacy-string member renders route: null');
    assert.equal(m.scope, null, 'D2.4 — a legacy-string member renders scope: null');
    assert.equal(m.liveness, 'local', 'D2.4 — a run-less legacy member reads liveness local');
    assert.equal(m.phase, null, 'D2.4 — the no-run member has no phase');
    assert.equal(m.progressClass, null, 'D2.4 — the no-run member has no progress class');
    assert.equal(m.attentionCount, null, 'D2.4 — the no-run member has no attention count');
    assert.equal(Object.hasOwn(m, 'error'), false, 'the no-run member carries no refusal error');
  }
});

test('B-2 PIN (A2-5): a malformed NEW-shape roster refuses wave_registry_invalid (store-integrity)', async (t) => {
  const host = await hostFixture(t);
  const malformedWaveId = `wave:${createHash('sha256').update('malformed-157-pin').digest('hex').slice(0, 32)}`;
  assert.throws(
    () => host.driver.coordination.recordDriver('wave.started', {
      waveId: malformedWaveId, roster: 'not-an-array', idempotencyKey: 'bad-157-ik',
    }, { actor: 'test', key: `wave.started:${malformedWaveId}` }),
    (error) => {
      assert.equal(error.code, 'coordination_projection_poisoned',
        'the B2 fold wraps the malformed NEW-shape append (coordination-store.mjs:8099-8123)');
      assert.equal(error.cause?.code, 'wave_registry_invalid',
        'the store-integrity code wave_registry_invalid rides the poison\'s cause (coordination-store.mjs:8113)');
      return true;
    },
  );
});

test('B-3 PIN (A5-1): `baton waves list` parses to waves.list', () => {
  const parsed = parseBatonCli(['waves', 'list']);
  assert.equal(parsed.kind, 'command', 'the plural waves.list verb parses');
  assert.equal(parsed.name, 'waves.list');
  assert.deepEqual(parsed.args, {});
});

test('B-4 PIN (A5-2): `baton waves progress WAVE_ID` parses to waves.progress', () => {
  const parsed = parseBatonCli(['waves', 'progress', WAVE_ID]);
  assert.equal(parsed.kind, 'command', 'the plural waves.progress verb parses');
  assert.equal(parsed.name, 'waves.progress');
  assert.deepEqual(parsed.args, { waveId: WAVE_ID });
});

test('B-5 PIN (A5-3): singular `wave` refuses cli_command_unavailable with the plural corrective naming the RIGHT verb', () => {
  assert.throws(
    () => parseBatonCli(['wave', 'list']),
    (error) => {
      assert.equal(error.code, 'cli_command_unavailable');
      assert.match(error.message, /waves list/u,
        'the singular corrective names the plural verb for the requested action (application-cli.mjs:1314-1322 — pluralCorrective already names send/stop at :1316, so D1 must not touch it)');
      return true;
    },
  );
});

test('B-6 PIN (A5-4): a bare `baton waves attach` issues waves.list — never the wave-ID-invalid refusal', () => {
  const parsed = parseBatonCli(['waves', 'attach']);
  assert.equal(parsed.kind, 'command', 'the bare attach issues the registry read');
  assert.equal(parsed.name, 'waves.list');
  assert.deepEqual(parsed.args, {});
});

test('B-7 PIN (A5-5 F11): the issued bare-attach shape runs the full parse→dispatch→render pipeline and surfaces the attachable set', async (t) => {
  const host = await hostFixture(t);
  const wave = await host.application.command('waves.start', {
    idempotencyKey: 'b-7', members: [memberExact('alpha', 'write the alpha report')],
  }, principal('wave-owner'));
  const parsed = parseBatonCli(['waves', 'attach']);
  assert.equal(parsed.name, 'waves.list', 'the issued command is waves.list (F5)');
  const rendered = await runBatonCli(parsed, cliRoutingClient(host));
  assert.ok(rendered !== null && typeof rendered === 'object' && Array.isArray(rendered.waves),
    'the rendered waves.list passes through the CLI pipeline unchanged — a resolved command exits 0');
  const row = rendered.waves.find((w) => w.waveId === wave.waveId);
  assert.ok(row, 'the started wave is surfaced through the pipeline');
  assert.deepEqual(row.roster.map((m) => m.role), ['alpha'], 'the attachable set renders for the operator');
});

test('B-8 PIN (A6-6 F4): `baton waves start --members JSON` drives an admission-exceeding objective through the full CLI pipeline — typed wave_member_invalid', async (t) => {
  const host = await hostFixture(t);
  const members = [memberExact('alpha', BIG_OBJECTIVE)];
  const parsed = parseBatonCli(['waves', 'start', '--members', JSON.stringify(members)]);
  assert.equal(parsed.name, 'waves.start', 'the CLI verb compiles to the direct-port waves.start');
  assert.ok(Array.isArray(parsed.args.members) && parsed.args.members.length === 1,
    'the --members JSON payload becomes the dispatch members');
  let refusal = null;
  try {
    await runBatonCli(parsed, cliRoutingClient(host));
  } catch (error) {
    refusal = error;
  }
  assert.ok(refusal !== null,
    'the admission-exceeding wave refuses through the CLI dispatch — never a silent per-member swallow');
  assert.equal(refusal.code, 'wave_member_invalid', 'the CLI leg carries the typed body.error code (F4)');
  assert.equal(refusal.message, 'wave member alpha did not start',
    'the CLI error message is byte-identical to the embedded refusal (W6/F4)');
  const detail = refusal.detail ?? refusal;
  assert.equal(detail.cap, SPILL_BODY_CEILING, 'the refusal names the spill.body ceiling');
  assert.equal(detail.role, 'alpha', 'the offending member role is named');
  assert.equal(detail.cause?.code, 'spill_body_exceeded', 'the inner admission code is preserved in cause');
});
