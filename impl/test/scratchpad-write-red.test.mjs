// Issue #158 — the folded shared-scratchpad WRITE verb. Red-first acceptance suite for the folded
// #158 contract v1.1 (the surface completion of the #33 worker write lane: `run.scratchpad.append`
// on CLI/MCP/web, with the D1 write law, the D2 surface admission, the D3 replay/bounds, and the
// D4 bare-subcommand teaching).
//
// [attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512]
//
// Binding contract: docs/reference/evidence/scratchpad-write-2026-08-13/
//   contract-fold.md v1.1 (source of truth), contract-redteam.md — the A1-A10 acceptance pins, the
//   D1/D1.2/D2/D3/D4 folded laws, the refusal vocabulary, the H1.x/H2.x/H3.x blocker folds, and the
//   OQ resolutions. Idioms: wave-observability-red.test.mjs (the openHost fixture machinery this
//   suite drives `application.command`, WebNorthbound and McpFleetServer through), and
//   worker-orchestrated-swarm-red.test.mjs (the fixture-installed deployment restrictor whose law
//   mechanics are provable hermetically while the DEPLOYMENT seam is pinned statically).
//
// Rows: 24 (18 red + 6 pin). Red-first: every red row fails today at a NAMED stage and goes green
// on the #158 implementation ONLY — never on a hardcoded fixture or a shallow per-surface admit.
// The six pin rows are green today AND under the correct implementation, but fail a plausible
// WRONG one (each pin names the wrong implementation it kills).
//
// Stage table (every red row's named stage, the rung the implementer must add):
//   cli-append-branch-missing        A1-1  the parser gains the append branch (application-cli.mjs:1476-1511)
//   cli-append-json-shape-missing    A1-2  the non-note JSON body parse + closed per-kind shape (H2.3)
//   mcp-append-tool-missing          A2-1  the tool is advertised (capabilities + tools/list + mcpApplicationToolNames)
//   mcp-append-dispatch-branch-missing  A2-2  tools/call for the name is DISPATCHED, never the absent-tool -32602
//   mcp-append-admission-missing     A2-3  TOOL_DEFINITIONS + ORDINARY_EXPLICIT_TOOLS + _dispatch chain reference the tool
//   web-append-dispatch-missing      A3-1  a valid envelope dispatches to a receipt, never `unsupported command`
//   web-append-admission-missing     A3-2  the FOUR-table direct-port admission incl. WEB_DIRECT_PORT_COMMANDS (H2.1)
//   append-restrictor-missing        A4-1  the deployment seam installs the append restrictor (D1 law 2/3)
//   own-run-predicate-missing        A4-2  the restrictor ENFORCES the own-run predicate via a seat-resolver (H1.1)
//   review-authority-append-missing  A5-1  the review authority's shared-only advisory posture (D1 law 3)
//   append-candidacy-shortcut-missing  A6-1  the append verb is a direct EPHEMERAL write, never a candidacy mint (law 4)
//   append-body-limit-missing        A7-1  the surface exposes scratchpad_entry_exceeded for a >8192 B body (OQ4)
//   append-shared-cap-missing        A7-2  the 513th shared append refuses scratchpad_partition_exhausted (G8)
//   append-worker-cap-missing        A7-3  the 129th worker:<ownId> append refuses scratchpad_partition_exhausted
//   append-replay-scope-missing      A8-1  exact retry idempotent / changed binding conflict / same-key-diff-scope DISTINCT (H3.1)
//   bare-scratchpad-teaching-missing A9-1  bare `run scratchpad` teaches `read|elevate|append`, never `undefined` (D4)
//   unknown-subverb-teaching-missing A9-2  an unknown subverb is named AND the closed set is restated (D4)
//   append-admission-incoherent      A10-1 the verb is coherently admitted across parser/CLI_WEB_COMMANDS/
//                                        web-four-table/MCP/registry/docs — no #157 ghost (the three-way)
//
// Pin rows (green at HEAD):
//   P-A1  the read/elevate half of the parity table stays served (the substrate the write completes)
//   P-A4  the kernel _byKey replay binding has NO scope term — the two-scope namespacing is the
//         SURFACE's job (H3.1), never a kernel-envelope amendment
//   P-A5  the deployment seam no longer wires the permissive `authorize: async () => true,` literal
//         (the read-law restrictor stays the shipped default)
//   P-A6  the _authorize seam is byte-stable (:3222) and the read verb passes {scope} (:13097) — the
//         seam the append verb mirrors
//   P-A7  the kernel bounds sit at the declared constants (128/512 caps, 8192 B body, the typed
//         scratchpad_partition_exhausted / scratchpad_entry_exceeded refusals) — the surface exposes
//         them verbatim
//   P-A10 no #157 ghost TODAY: for the served read/elevate verbs the parser ⇔ CLI_WEB_COMMANDS ⇔ MCP
//         ⇔ registry all agree
//
// RED/GREEN split at HEAD e371f70 (recorded after TWO consecutive runs from the repo root;
// `node --test impl/test/scratchpad-write-red.test.mjs` — 24 rows, 6 pass / 18 fail, identical
// across both runs):
//   RED   18 — A1-1, A1-2, A2-1, A2-2, A2-3, A3-1, A3-2, A4-1, A4-2, A5-1, A6-1, A7-1, A7-2,
//              A7-3, A8-1, A9-1, A9-2, A10-1   (each fails at its named stage)
//   GREEN  6 — P-A1, P-A4, P-A5, P-A6, P-A7, P-A10
//
// NUL discipline: application.mjs / coordination-store.mjs carry NUL bytes, so their static source
// pins use execFileSync grep -an only (srcAnchor / grepLines below) — never whole-file reads. The
// NUL-free files (application-cli.mjs, mcp-northbound.mjs, web-northbound.mjs,
// application-deployment.mjs, application-semantics.mjs, limits.mjs) are read whole where a region
// pin needs it. This suite file contains 0 NUL bytes.
//
// No clocks: the only timestamps are the fixed NOW constant passed to the surfaces' clock/now hooks;
// every projection assertion rides event seqs only. localeCompare is never used; sorted-key literals
// below are in ACTUAL order (SCRATCHPAD_KINDS = ['note','plan','doubt','link'],
// coordination-store.mjs:535).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import {
  bindBaton, CoordinationStore, createDriver, McpFleetServer, WebNorthbound,
} from '../src/index.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';
import { mcpApplicationToolNames } from '../src/mcp-northbound.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import {
  MAX_SCRATCHPAD_SHARED_ENTRIES, MAX_SCRATCHPAD_WORKER_ENTRIES,
} from '../src/coordination-store.mjs';

// ---------------------------------------------------------------------------
// Constants (closed, byte-stable — the fixture's stand-in for the operator's
// deployment profile; the surface lanes are driven through the same ordinary
// mock route `waves.start` uses, so a started run would admit identically).
// ---------------------------------------------------------------------------

const REPO_ID = 'repo-158';
const ORIGIN = 'https://example.test';
const NOW = Date.parse('2026-08-13T12:00:00.000Z');

// SCRATCHPAD_KINDS — ACTUAL sorted order (coordination-store.mjs:535). The append
// closure defaults `kind` to `note`; plan/doubt/link carry the closed per-kind shape.
const SCRATCHPAD_KINDS = Object.freeze(['note', 'plan', 'doubt', 'link']);

// The kernel's exported caps (P-A7) — 128 worker entries, 512 shared entries.
const SHARED_CAP = MAX_SCRATCHPAD_SHARED_ENTRIES;
const WORKER_CAP = MAX_SCRATCHPAD_WORKER_ENTRIES;

const PROFILE = Object.freeze({
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
});

// ---------------------------------------------------------------------------
// Fixture (wave-observability idiom): a minimal BatonApplication bound to a
// per-test temp git repo, a marker mock adapter, and a parameterized authorize
// seam. The A4/A5/A6 law rows install the suite's INVENTED append restrictor at
// that seam (blueteam §1.1 — the deployment seam is not in the hermetic test
// path, so the fixture must install the suite's copy of the law); the DEPLOYMENT
// seam is then pinned statically, exactly as worker-orchestrated-swarm does for
// the D1.2 read law.
// ---------------------------------------------------------------------------

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-158-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', [
    '-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base',
  ], { cwd: dir });
  return dir;
}

function principal(id, overrides = {}) {
  return Object.freeze({
    actor: 'test', principalId: id, sessionId: `session-${id}`,
    ...overrides,
  });
}

// The markerAdapter card override is required for exact-route admission (the run.start lane checks
// the deployment card's modelSelection before admitting a member route).
function markerAdapter() {
  const adapter = new MockAdapter({ scenario: { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'scratchpad-write-158', refreshedAt: null,
    },
  });
  return adapter;
}

function deploymentIdFor(repo, logDir) {
  return `deployment-${createHash('sha256').update(`${repo}|${logDir}`).digest('hex').slice(0, 32)}`;
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

function buildApplication(driver, deploymentId, authorize) {
  const base = {
    driver,
    repoId: REPO_ID,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: authorize ?? (async () => true),
  };
  try {
    // The fold accepts deploymentId as an optional constructor field. HEAD does NOT — the config
    // validator rejects the unknown field (application_config_invalid), so the bare-options retry
    // keeps the fixture green-side honest at HEAD.
    return new BatonApplication({ ...base, deploymentId });
  } catch (error) {
    if (error?.code !== 'application_config_invalid') throw error;
    return new BatonApplication(base);
  }
}

function openHost(repo, logDir, adapter, authorize) {
  const driver = createDriverFor(repo, logDir, adapter);
  const deploymentId = deploymentIdFor(repo, logDir);
  const application = buildApplication(driver, deploymentId, authorize);
  const baton = bindBaton(application, principal('wave-owner'));
  return { application, baton, driver, deploymentId };
}

async function hostFixture(t, { authorize } = {}) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const host = openHost(repo, logDir, markerAdapter(), authorize);
  host.repo = repo;
  host.logDir = logDir;
  host.owner = principal('wave-owner');
  t.after(async () => {
    await host.application.shutdown(principal('cleanup')).catch(() => {});
    try { host.driver.coordination.releaseWriterLease(); } catch { /* already released by shutdown */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return host;
}

// The D1 WRITE-law restrictor (suite-invented, installed at the FIXTURE seam so the law's mechanics
// are provable hermetically — the deployment seam is not in the hermetic test path, swarm §1.1):
//   * `shared` resolves for every principal (law 1), including the review authority (law 3);
//   * `worker:<scope>` resolves only for `principalId === scope` (law 2), and for a worker seat the
//     own-run predicate (H1.1) is enforced via the seat map — a seat whose active run differs from
//     the caller-supplied runId refuses;
//   * a review authority (`local-owner` / `service-*`) is SHARED-ONLY (law 3 — the trust-doctrine
//     divergence from the D1.2 read law);
//   * unknown scope ≡ foreign (the "unknown ≡ foreign at the policy seam" default, #87).
// Every non-append command stays permissive.
function appendRestrictor({ seats = {} } = {}) {
  return async (request = {}) => {
    const { command, principal, runId, subject } = request;
    if (command !== 'run.scratchpad.append') return true;
    const scope = subject?.scope;
    const pid = typeof principal?.principalId === 'string' ? principal.principalId : '';
    const review = pid === 'local-owner' || pid.startsWith('service-');
    if (scope === 'shared') {
      if (pid.startsWith('worker:') && seats[pid] !== undefined && seats[pid] !== runId) return false;
      return true;
    }
    if (typeof scope === 'string' && scope.startsWith('worker:')) {
      if (review) return false; // review authority: shared-only advisory append (law 3)
      if (pid !== scope) return false; // a member appends only to its own partition (law 2)
      if (seats[pid] !== undefined && seats[pid] !== runId) return false; // H1.1 own-run predicate
      return true;
    }
    return false; // unknown ≡ foreign at the policy seam
  };
}

async function lawFixture(t, seats = {}) {
  const restrictor = appendRestrictor({ seats });
  const host = await hostFixture(t, { authorize: restrictor });
  host.authorize = restrictor; // the direct-predicate seam (what _authorize drives, application.mjs:3214-3222)
  return host;
}

// ---------------------------------------------------------------------------
// Small capture helpers — a red row's FIRST failing assertion must name its stage.
// ---------------------------------------------------------------------------

function capture(fn) {
  try { return { ok: true, value: fn() }; }
  catch (error) { return { ok: false, error }; }
}

async function captureAsync(promise) {
  try { return { ok: true, value: await promise }; }
  catch (error) { return { ok: false, error }; }
}

function stageAssert(condition, stage, note) {
  assert.ok(condition, `stage[${stage}]: ${note}`);
}

// ---------------------------------------------------------------------------
// NUL-safe static source pins (execFileSync grep -an handles the NUL bytes in
// application.mjs / coordination-store.mjs).
// ---------------------------------------------------------------------------

function srcAnchor(file, pattern) {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  // -E (ERE): our patterns use `\(`, `\)`, `\?`, `\.` as LITERALS. In BRE an escaped paren is a
  // group that must be balanced — `\(` with no `\)` makes grep die "parentheses not balanced".
  const out = execFileSync('/usr/bin/grep', ['-anE', pattern, join(root, file)], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  }).trim().split('\n').filter(Boolean);
  if (out.length === 0) throw new Error(`source anchor ${file} ~ ${pattern} not found`);
  const first = out[0];
  const colon = first.indexOf(':');
  return { line: Number(first.slice(0, colon)), text: first.slice(colon + 1) };
}

function grepLines(file, pattern) {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  try {
    const out = execFileSync('/usr/bin/grep', ['-anE', pattern, join(root, file)], {
      encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    }).trim().split('\n').filter(Boolean);
    return out.map((entry) => {
      const colon = entry.indexOf(':');
      return { line: Number(entry.slice(0, colon)), text: entry.slice(colon + 1) };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// MCP / web fixture seams (wave-observability idiom).
// ---------------------------------------------------------------------------

function waveEnvelope(command, args) {
  return {
    schemaVersion: 1,
    commandId: `c158-${createHash('sha256').update(`${command}:${JSON.stringify(args)}`).digest('hex').slice(0, 16)}`,
    idempotencyKey: `ik158-${command}`,
    command,
    args,
    repoId: REPO_ID,
    origin: ORIGIN,
  };
}

function webFixture(t, host) {
  const web = new WebNorthbound({
    coordinator: {},
    coordination: new CoordinationStore(join(host.logDir, 'web-coord'), {
      clock: () => new Date(NOW).toISOString(),
    }),
    repoIds: [REPO_ID],
    allowedOrigins: [ORIGIN],
    now: () => NOW,
    application: host.application,
  });
  const webCtx = {
    principal: {
      userId: 'web-op', sessionId: 'web-sess', credentialId: 'web-cred',
      authMethod: 'cookie', csrfToken: 'csrf-158',
      expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
      capabilities: ['observe', 'control', 'emergency_stop'], repoIds: [REPO_ID],
    },
    origin: ORIGIN, csrfToken: 'csrf-158',
    remoteAddress: '127.0.0.1', transport: 'https',
  };
  return { web, webCtx };
}

async function mcpFixture(t, host) {
  const coordination = new CoordinationStore(join(host.logDir, 'mcp-coord'), {
    clock: () => new Date(NOW).toISOString(),
  });
  const server = new McpFleetServer({
    coordinator: {},
    coordination,
    application: host.application,
    surface: 'application',
    principal: {
      userId: 'mcp-op', sessionId: 'mcp-sess',
      capabilities: ['observe', 'control', 'emergency_stop'],
      repoIds: [REPO_ID],
      expiresAt: new Date(NOW + 60_000).toISOString(),
      revoked: false,
    },
    repoIds: [REPO_ID],
    now: () => NOW,
    maxWaitMs: 25_000,
    maxMessageBytes: 64 * 1024,
    takeToolQuota: async () => ({ ok: true }),
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
  });
  const init = await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wave158', version: '0' } },
  });
  assert.ok(init?.result?.protocolVersion, 'mcp initialize resolves');
  // The fleet server marks the session initialized on this notification; without it every
  // subsequent tools/* call is refused -32002 "Server not initialized" (wave-observability
  // mcpFixture sends the same handshake, impl/test/wave-observability-red.test.mjs:451).
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  return { server };
}

// ---------------------------------------------------------------------------
// A1 — CLI append (D2.2 / H2.3)
// ---------------------------------------------------------------------------

test('A1-1 stage[cli-append-branch-missing]: baton run scratchpad append RUN --scope shared --kind note --body TEXT resolves to the closed append command', async () => {
  const parsed = capture(() => parseBatonCli([
    'run', 'scratchpad', 'append', 'run:m1', '--scope', 'shared', '--kind', 'note', '--body', 'handoff note',
  ]));
  stageAssert(parsed.ok, 'cli-append-branch-missing',
    `the scratchpad parser branch (application-cli.mjs:1476-1511) must gain the append case; at HEAD the parser throws ${
      parsed.error?.message ?? parsed.error?.code ?? '?'} — the append branch is the missing rung`);
  assert.equal(parsed.value.kind, 'command', 'the append parse is a command');
  assert.equal(parsed.value.name, 'run.scratchpad.append',
    'the canonical operation name is run.scratchpad.append (D2.1)');
  assert.deepEqual(parsed.value.args, {
    runId: 'run:m1', scope: 'shared', kind: 'note', body: 'handoff note',
  }, 'the closed arg closure {runId, scope, kind, body} (D2.1 — no caller-supplied workerId, H1.3)');
  // GREEN condition stated: a `shared` receipt depends on the unlanded tight-cell shared-write
  // kernel path (tight-cell-contract.md:808 "today: orchestrator elevation only") — this pin does
  // not hide that kernel dependency (A1 GREEN condition).
  assert.equal(parsed.value.args.kind, 'note', '--kind note exercises the CLI text body (A1)');
});

test('A1-2 stage[cli-append-json-shape-missing]: the non-note JSON body path parses into the closed per-kind shape (H2.3)', async () => {
  const plan = capture(() => parseBatonCli([
    'run', 'scratchpad', 'append', 'run:m1', '--scope', 'worker:m1', '--kind', 'plan',
    '--body', '{"objective":"plan it","steps":["a","b"]}',
  ]));
  stageAssert(plan.ok, 'cli-append-json-shape-missing',
    `the CLI must JSON-parse the non-note body into the kernel's closed per-kind shape (normalizeScratchpadEntry, coordination-store.mjs:607-696) and refuse a malformed body with cli_invalid naming the expected shape (H2.3, mirroring the elevate branch's --entries handling); at HEAD the parser throws ${
      plan.error?.message ?? plan.error?.code ?? '?'}`);
  assert.equal(plan.value.name, 'run.scratchpad.append', 'the plan append parses to the append verb');
  assert.equal(plan.value.args.scope, 'worker:m1', 'a member may target its own worker:<ownId> partition');
  assert.deepEqual(plan.value.args.body, { objective: 'plan it', steps: ['a', 'b'] },
    'the plan body rides the closed {objective, steps} shape');
  const bad = capture(() => parseBatonCli([
    'run', 'scratchpad', 'append', 'run:m1', '--scope', 'worker:m1', '--kind', 'plan', '--body', 'not-json',
  ]));
  stageAssert(bad.ok === false && /cli_invalid|JSON/u.test(bad.error?.message ?? ''), 'cli-append-json-shape-missing',
    'a malformed non-note body refuses cli_invalid naming the expected JSON shape (H2.3) — never a silent string');
});

// ---------------------------------------------------------------------------
// A2 — MCP append (D2.3 / H2.2)
// ---------------------------------------------------------------------------

test('A2-1 stage[mcp-append-tool-missing]: baton_run_scratchpad_append is advertised — capabilities, mcpApplicationToolNames, and tools/list', async (t) => {
  const host = await hostFixture(t);
  const { server } = await mcpFixture(t, host);
  const sorted = mcpApplicationToolNames();
  stageAssert(sorted.includes('baton_run_scratchpad_append'), 'mcp-append-tool-missing',
    'the ordinary MCP surface must carry baton_run_scratchpad_append (mcp-northbound.mjs:2222); at HEAD the tool is absent');
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = (listed?.result?.tools ?? []).map((tool) => tool.name);
  stageAssert(names.includes('baton_run_scratchpad_append'), 'mcp-append-tool-missing',
    'tools/list must advertise the append tool with the closed inputSchema {runId, scope, kind, body, idempotencyKey} (D2.1); at HEAD it is absent');
  // The capability row (A2): the append verb is a write — ['control', 'observe'], exactly like the
  // elevate sibling (mcp-northbound.mjs:115).
  stageAssert(grepLines('mcp-northbound.mjs', 'baton_run_scratchpad_append:').length > 0, 'mcp-append-tool-missing',
    'the MCP capability map must carry baton_run_scratchpad_append: [\'control\', \'observe\'] (mcp-northbound.mjs:114-115); at HEAD only read/elevate are listed');
});

test('A2-2 stage[mcp-append-dispatch-branch-missing]: tools/call for a valid append dispatch is routed, never the absent-tool protocolError', async (t) => {
  const host = await hostFixture(t);
  const { server } = await mcpFixture(t, host);
  const call = await server.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: {
      name: 'baton_run_scratchpad_append',
      arguments: { repoId: REPO_ID, runId: 'run:m1', scope: 'worker:m1', kind: 'note', body: 'hello' },
    },
  });
  // RED gate: the call must be DISPATCHED — a tool result rides on call.result. At HEAD the name is
  // not in this.toolNames and the call falls to the absent-tool protocolError -32602 "Invalid
  // params" (mcp-northbound.mjs:1393) — call.result is undefined, this assert fails. Post-#158 the
  // _dispatch chain gains the else-if branch routing to application.command('run.scratchpad.append',
  // …) (H2.2, the branch pattern at :1900-1909) and a result lands.
  stageAssert(call?.result !== undefined, 'mcp-append-dispatch-branch-missing',
    `a valid append call must be DISPATCHED — the _dispatch chain must gain the else-if branch routing to application.command('run.scratchpad.append', …) (H2.2, the branch pattern at mcp-northbound.mjs:1900-1909); at HEAD the name is not in this.toolNames and the call falls through the absent-tool protocolError (${
      call?.error?.message ?? 'no error'}) — the advertised-but-dead trap`);
});

test('A2-3 stage[mcp-append-admission-missing]: TOOL_DEFINITIONS + ORDINARY_EXPLICIT_TOOLS + the _dispatch chain all reference the tool', async () => {
  // TOOL_DEFINITIONS (mcp-northbound.mjs:830) is the union of the ordinary/application/advanced/
  // reflex tables; the append tool must land in APPLICATION_TOOL_DEFINITIONS (:652-668) beside
  // read/elevate so the pinned enumeration and the typed-failure lane both see it.
  const toolDef = grepLines('mcp-northbound.mjs', "name: 'baton_run_scratchpad_append'");
  stageAssert(toolDef.length > 0, 'mcp-append-admission-missing',
    'the append tool must be admitted in APPLICATION_TOOL_DEFINITIONS (mcp-northbound.mjs:652-668) — beside baton_run_scratchpad_read/elevate');
  const explicit = grepLines('mcp-northbound.mjs', "'baton_run_scratchpad_append'");
  stageAssert(explicit.some((row) => row.line > 700 && row.line < 900), 'mcp-append-admission-missing',
    'the append tool must be admitted in ORDINARY_EXPLICIT_TOOLS (mcp-northbound.mjs:822-829) — the typed-failure lane — so a tool error never degrades to a bare protocolError');
  const dispatch = grepLines('mcp-northbound.mjs', "else if (name === 'baton_run_scratchpad_append')");
  stageAssert(dispatch.length > 0, 'mcp-append-admission-missing',
    'the _dispatch chain must gain the append branch (H2.2) — the missing rung that makes an advertised tool dead');
});

// ---------------------------------------------------------------------------
// A3 — web append (D2.4 / H2.1)
// ---------------------------------------------------------------------------

test('A3-1 stage[web-append-dispatch-missing]: a valid run_scratchpad_append envelope dispatches to a receipt, never `unsupported command`', async (t) => {
  const host = await hostFixture(t);
  const { web, webCtx } = webFixture(t, host);
  const res = await web.execute(webCtx, waveEnvelope('run_scratchpad_append', {
    runId: 'run:m1', scope: 'worker:m1', kind: 'note', body: 'hello',
  }));
  stageAssert(res.status === 200, 'web-append-dispatch-missing',
    `the append envelope must be admitted and DISPATCHED (assert a receipt, never a refusal); at HEAD validateEnvelope refuses 400 invalid_command "unsupported command" (web-northbound.mjs:405) — the append transport is not admitted, and no receipt exists to assert`);
  stageAssert(res.body?.ok === true, 'web-append-dispatch-missing',
    'a valid append envelope dispatches to a written receipt — never refused application_command_arguments_invalid (the H2.1 #157 ghost)');
});

test('A3-2 stage[web-append-admission-missing]: the direct-port admission is the FOUR tables incl. WEB_DIRECT_PORT_COMMANDS (H2.1)', async () => {
  const src = readFileSync(fileURLToPath(new URL('../src/web-northbound.mjs', import.meta.url)), 'utf8');
  // Region-restricted table checks: each admission table must carry the append transport name.
  const table = (startToken, endToken) => {
    const s = src.indexOf(startToken);
    const e = src.indexOf(endToken, s + 1);
    return s === -1 || e === -1 ? '' : src.slice(s, e);
  };
  const capabilityRegion = table('const COMMAND_CAPABILITY', 'const ARG_FIELDS');
  const argFieldsRegion = table('const ARG_FIELDS', 'const ACCEPTED_ARG_FIELDS');
  const applicationCommandRegion = table('const APPLICATION_COMMAND', 'function validateEnvelope');
  const directPortRegion = table('const WEB_DIRECT_PORT_COMMANDS', '// ');
  stageAssert(/run_scratchpad_append/u.test(capabilityRegion), 'web-append-admission-missing',
    'COMMAND_CAPABILITY (web-northbound.mjs:87-94) must carry run_scratchpad_append — the admission is four tables, and a missing capability row is a #157 ghost');
  stageAssert(/run_scratchpad_append/u.test(argFieldsRegion), 'web-append-admission-missing',
    'ARG_FIELDS/ACCEPTED_ARG_FIELDS (web-northbound.mjs:112-148) must carry the closed {runId, scope, kind, body, idempotencyKey} accepted set');
  stageAssert(/run_scratchpad_append/u.test(applicationCommandRegion), 'web-append-admission-missing',
    'APPLICATION_COMMAND (web-northbound.mjs:149-151) must route run_scratchpad_append to the application command');
  stageAssert(/run_scratchpad_append/u.test(directPortRegion), 'web-append-admission-missing',
    'WEB_DIRECT_PORT_COMMANDS (web-northbound.mjs:62) must carry run_scratchpad_append — the FOURTH table H2.1 names; at HEAD it holds only the waves_* transports, so every append envelope is refused `unsupported command` before the dispatch');
});

// ---------------------------------------------------------------------------
// A4 — D1 cross-partition AND cross-run refusal (law 2, H1.1)
// ---------------------------------------------------------------------------

test('A4-1 stage[append-restrictor-missing]: a member append to a sibling worker:<other> partition refuses at the _authorize seam — no entry is minted', async (t) => {
  const fx = await lawFixture(t, { 'worker:m1': 'run:m1', 'worker:m2': 'run:m2' });
  const seam = {
    command: 'run.scratchpad.append', repoId: REPO_ID, subject: {},
  };
  // GREEN — the law's mechanics, provable hermetically with the fixture-installed restrictor
  // (the seam _authorize drives, application.mjs:3214-3222):
  assert.equal(await fx.authorize({ ...seam, principal: principal('worker:m1'), runId: 'run:m1', subject: { scope: 'worker:m1' } }), true,
    'a member appends to its OWN worker:<ownId> partition (D1 law 1)');
  assert.equal(await fx.authorize({ ...seam, principal: principal('worker:m1'), runId: 'run:m1', subject: { scope: 'shared' } }), true,
    'a member contributes to shared directly (D1 law 1, G8)');
  assert.equal(await fx.authorize({ ...seam, principal: principal('worker:m2'), runId: 'run:m1', subject: { scope: 'worker:m1' } }), false,
    'a member append to a SIBLING worker:<other> partition refuses application_unauthorized (D1 law 2 — the "unknown ≡ foreign at the policy seam" default, #87) — refused BEFORE any entry is minted');
  // RED — the DEPLOYMENT seam must install the append restrictor. At HEAD the deployment authorize
  // (restrictingReadAuthorize, application-deployment.mjs:1728, installed :2041) falls through
  // `return true` for every non-read command, so the append verb is PERMISSIVE in production — the
  // write law is unwritten.
  stageAssert(grepLines('application-deployment.mjs', 'run\\.scratchpad\\.append').length > 0,
    'append-restrictor-missing',
    'the deployment seam (application-deployment.mjs:2041) must install an append restrictor whose policy is the D1 write law; at HEAD the read restrictor is permissive for the append verb — a cross-partition append would resolve');
});

test('A4-2 stage[own-run-predicate-missing]: the restrictor ENFORCES the own-run predicate — a member append to shared/worker:<ownId> of a run other than its own refuses (H1.1)', async (t) => {
  const fx = await lawFixture(t, { 'worker:m1': 'run:m1' });
  const seam = {
    command: 'run.scratchpad.append', repoId: REPO_ID, principal: principal('worker:m1'), subject: {},
  };
  // GREEN — the H1.1 own-run predicate, via the fixture-installed seat map:
  assert.equal(await fx.authorize({ ...seam, runId: 'run:other', subject: { scope: 'worker:m1' } }), false,
    'a member append to its OWN partition of a FOREIGN run refuses application_unauthorized (H1.1, D1 law 2) — the principal\'s active run is resolved, not taken from the caller');
  assert.equal(await fx.authorize({ ...seam, runId: 'run:other', subject: { scope: 'shared' } }), false,
    'a member append to shared of a FOREIGN run refuses application_unauthorized (H1.1) — the own-run predicate binds every scope the member may target');
  assert.equal(await fx.authorize({ ...seam, runId: 'run:m1', subject: { scope: 'worker:m1' } }), true,
    'the same member appending to its OWN run\'s own partition resolves');
  // RED — the DEPLOYMENT restrictor must be constructed with a seat-resolver closure — the
  // coordinator's _getWorker binding (coordinator.mjs:10791-10794, which writeScratchpad's wrapper
  // already uses to resolve a member's active task) — so the own-run predicate is ENFORCED at the
  // seam, not merely stated (H1.1 blocker 3).
  stageAssert(grepLines('application-deployment.mjs', '_getWorker').length > 0,
    'own-run-predicate-missing',
    'the append restrictor must be constructed with a seat-resolver closure (the coordinator _getWorker binding) so the D1 own-run predicate is enforced at the seam; at HEAD no append restrictor exists at the deployment seam at all');
});

// ---------------------------------------------------------------------------
// A5 — D1 review-authority posture (law 3, H1.4/H3.2)
// ---------------------------------------------------------------------------

test('A5-1 stage[review-authority-append-missing]: local-owner/service-* append to shared ONLY — never a member partition; the deployment installs the restrictor', async (t) => {
  const fx = await lawFixture(t, { 'worker:m1': 'run:m1' });
  const seam = {
    command: 'run.scratchpad.append', repoId: REPO_ID, subject: {},
  };
  // GREEN — law 3's shared-only advisory posture (the trust-doctrine divergence from the D1.2 read
  // law, which grants the review authority read of any member scope):
  assert.equal(await fx.authorize({ ...seam, principal: principal('local-owner'), runId: 'run:m1', subject: { scope: 'shared' } }), true,
    'local-owner appends to shared (resolves except at the declared shared cap, H1.4/H3.2 — the disclosed shared drain)');
  assert.equal(await fx.authorize({ ...seam, principal: principal('service-ops'), runId: 'run:m1', subject: { scope: 'shared' } }), true,
    'a service-* principal appends to shared');
  assert.equal(await fx.authorize({ ...seam, principal: principal('local-owner'), runId: 'run:m1', subject: { scope: 'worker:m1' } }), false,
    'local-owner NEVER writes a member worker:<scope> partition (principalId !== scope refuses application_unauthorized) — the review authority\'s write posture is shared-only (law 3)');
  assert.equal(await fx.authorize({ ...seam, principal: principal('service-ops'), runId: 'run:m1', subject: { scope: 'worker:m1' } }), false,
    'a service-* principal never writes a member partition');
  // RED — the deployment seam installs the append restrictor.
  stageAssert(grepLines('application-deployment.mjs', 'run\\.scratchpad\\.append').length > 0,
    'review-authority-append-missing',
    'the deployment must install the append restrictor carrying law 3 — a STRICTER posture than the D1.2 read law; at HEAD no append restrictor exists, so the review authority\'s append posture is undefined (permissive)');
});

// ---------------------------------------------------------------------------
// A6 — D1 shared-write is ephemeral (law 4, H1.2)
// ---------------------------------------------------------------------------

test('A6-1 stage[append-candidacy-shortcut-missing]: the append verb lands as a direct EPHEMERAL write — it never mints a scratch-fact / KG candidacy (law 4)', async () => {
  // GREEN — the elevation lane is the ONLY candidacy mint today: the elevate direct port exists and
  // routes to scratchpadElevate (application.mjs:12523 → :13131-13151), the pre-existing settlement
  // lane (elevateTaskScratchpad, coordination-store.mjs:14173+). The append verb must NOT ride it.
  const elevateBranch = grepLines('application.mjs', "name === 'run.scratchpad.elevate'");
  assert.ok(elevateBranch.length > 0, 'the elevate direct port exists (application.mjs:12523) — the elevation lane is the pre-existing candidacy mint (law 4 scope note)');
  // RED — the append verb must be a direct shared write in the direct-port block
  // (application.mjs:12514-12523) that does NOT route through scratchpadElevate/elevateTaskScratchpad.
  // At HEAD no append branch exists — the verb is unwritten, so no ephemeral write exists to be
  // held separate from candidacy.
  const appendBranch = grepLines('application.mjs', "name === 'run.scratchpad.append'");
  stageAssert(appendBranch.length > 0, 'append-candidacy-shortcut-missing',
    'the append verb must land in the direct-port dispatch block as an ephemeral shared write (D1 law 4, tight-cell-contract.md:818-822) — never a scratch-fact/KG candidacy shortcut; at HEAD the branch is absent (the verb is unwritten). GREEN condition: a direct shared write exists only via the unlanded tight-cell shared-write kernel path (G8)');
  // The append branch must not sit in the elevation path: the branch must be present but NOT the
  // elevate branch (which routes to scratchpadElevate). A shallow impl that aliases append to
  // elevate would put the branch here — the ephemeral guarantee is the discriminate.
  const elevateDispatch = srcAnchor('application.mjs', "name === 'run.scratchpad.elevate'");
  stageAssert(!(appendBranch.length > 0 && appendBranch[0].line === elevateDispatch.line),
    'append-candidacy-shortcut-missing',
    'the append branch must be its OWN direct port, never an alias of the elevate branch — a shared append needs no elevation (law 4)');
});

// ---------------------------------------------------------------------------
// A7 — D3 bounds through the surface (OQ4, G8)
// ---------------------------------------------------------------------------

test('A7-1 stage[append-body-limit-missing]: a body over scratchpad.entry.body (8192 B for a steering-registered run) refuses scratchpad_entry_exceeded', async (t) => {
  const fx = await lawFixture(t);
  const body = 'x'.repeat(FRAME_LIMITS['scratchpad.entry.body'].value + 1);
  const attempt = await captureAsync(fx.application.command('run.scratchpad.append',
    { runId: 'run:steer', scope: 'shared', kind: 'note', body },
    principal('worker:m1')));
  stageAssert(attempt.ok === false && attempt.error?.code === 'scratchpad_entry_exceeded',
    'append-body-limit-missing',
    `the append surface must expose the kernel's single refusal verbatim — a body over ${
      FRAME_LIMITS['scratchpad.entry.body'].value} B refuses scratchpad_entry_exceeded (OQ4: the 8192/2048 steering split is a doc note, never a second surface code); at HEAD the surface is absent and the command throws ${
      attempt.error?.code ?? '?'} (application_command_unavailable)`);
});

test('A7-2 stage[append-shared-cap-missing]: the 513th shared append refuses scratchpad_partition_exhausted', async (t) => {
  const fx = await lawFixture(t);
  const attempt = await captureAsync(fx.application.command('run.scratchpad.append',
    { runId: 'run:steer', scope: 'shared', kind: 'note', body: `entry ${SHARED_CAP + 1}` },
    principal('worker:m1')));
  stageAssert(attempt.ok === false && attempt.error?.code === 'scratchpad_partition_exhausted',
    'append-shared-cap-missing',
    `the ${SHARED_CAP + 1}th shared append must refuse scratchpad_partition_exhausted (the declared 512-entry shared cap, coordination-store.mjs:525; H1.4 — the shared tier is a disclosed shared drain). GREEN condition: the shared-write path is the unlanded tight-cell shared-write kernel mechanism (G8); at HEAD no append surface exists to test the bound through (${attempt.error?.code ?? '?'})`);
});

test('A7-3 stage[append-worker-cap-missing]: the 129th worker:<ownId> append refuses scratchpad_partition_exhausted', async (t) => {
  const fx = await lawFixture(t, { 'worker:m1': 'run:m1' });
  const attempt = await captureAsync(fx.application.command('run.scratchpad.append',
    { runId: 'run:m1', scope: 'worker:m1', kind: 'note', body: `entry ${WORKER_CAP + 1}` },
    principal('worker:m1')));
  stageAssert(attempt.ok === false && attempt.error?.code === 'scratchpad_partition_exhausted',
    'append-worker-cap-missing',
    `the ${WORKER_CAP + 1}th worker:<ownId> append must refuse scratchpad_partition_exhausted (MAX_SCRATCHPAD_WORKER_ENTRIES=128, coordination-store.mjs:524; the kernel refusal at :14106-14107); at HEAD no append surface exposes the bound (${attempt.error?.code ?? '?'})`);
});

// ---------------------------------------------------------------------------
// A8 — D3 replay and the two-scope idempotency binding (H3.1, OQ2)
// ---------------------------------------------------------------------------

test('A8-1 stage[append-replay-scope-missing]: exact retry replays idempotent; changed binding refuses scratchpad_write_conflict; a same-key different-scope retry lands DISTINCT (H3.1)', async (t) => {
  const fx = await lawFixture(t, { 'worker:m1': 'run:m1' });
  const first = await captureAsync(fx.application.command('run.scratchpad.append',
    { runId: 'run:m1', scope: 'worker:m1', kind: 'note', body: 'hi', idempotencyKey: 'ik-a8' },
    principal('worker:m1')));
  stageAssert(first.ok && first.value?.result === 'written',
    'append-replay-scope-missing',
    `the first append writes (receipt result:"written"); at HEAD the surface is absent and the command throws ${
      first.error?.code ?? '?'} (application_command_unavailable)`);
  // An exact retry under the same namespaced key replays the prior receipt (kernel _byKey, D3).
  const exact = await captureAsync(fx.application.command('run.scratchpad.append',
    { runId: 'run:m1', scope: 'worker:m1', kind: 'note', body: 'hi', idempotencyKey: 'ik-a8' },
    principal('worker:m1')));
  assert.equal(exact.value?.result, 'idempotent', 'an exact retry under the same key+scope replays idempotent (D3, coordination-store.mjs:14086-14102)');
  assert.equal(exact.value?.entryId, first.value?.entryId, 'the idempotent replay returns the prior entryId');
  // A retry whose binding changed refuses scratchpad_write_conflict.
  const conflict = await captureAsync(fx.application.command('run.scratchpad.append',
    { runId: 'run:m1', scope: 'worker:m1', kind: 'note', body: 'changed', idempotencyKey: 'ik-a8' },
    principal('worker:m1')));
  assert.equal(conflict.error?.code, 'scratchpad_write_conflict',
    'a retry whose binding changed (different contentDigest) under the same key refuses scratchpad_write_conflict (:14091)');
  // A same-key DIFFERENT-scope retry lands as a DISTINCT entry — the surface namespaces EVERY key
  // by scope before the kernel auth (auth.key = `${callerKey}:${scope}`, H3.1), so a key first used
  // for worker:<ownId> and then for shared never replays against the wrong binding (OQ2 now pinned).
  const cross = await captureAsync(fx.application.command('run.scratchpad.append',
    { runId: 'run:m1', scope: 'shared', kind: 'note', body: 'hi', idempotencyKey: 'ik-a8' },
    principal('worker:m1')));
  stageAssert(cross.ok && cross.value?.result === 'written' && cross.value?.entryId !== first.value?.entryId,
    'append-replay-scope-missing',
    'a same-key different-scope retry lands on a DISTINCT kernel binding (distinct entry) — the surface namespaces the key by scope before the kernel auth (H3.1); at HEAD the surface is absent, so the two-scope disambiguation cannot exist');
});

// ---------------------------------------------------------------------------
// A9 — D4 bare-`run scratchpad` teaching (the message and the parser branch land
// in the SAME rung)
// ---------------------------------------------------------------------------

test('A9-1 stage[bare-scratchpad-teaching-missing]: bare `baton run scratchpad` refuses with the closed-set teaching read|elevate|append — never `unexpected argument undefined`', async () => {
  const bare = capture(() => parseBatonCli(['run', 'scratchpad']));
  stageAssert(bare.ok === false && /requires a subcommand: read\|elevate\|append/u.test(bare.error?.message ?? ''),
    'bare-scratchpad-teaching-missing',
    `bare \`run scratchpad\` must refuse with the closed-set teaching \`run scratchpad requires a subcommand: read|elevate|append\` (D4) — never \`unexpected argument undefined\` (application-cli.mjs:1511); at HEAD the throw is "${
      bare.error?.message ?? 'no throw'}"`);
});

test('A9-2 stage[unknown-subverb-teaching-missing]: an unknown subverb names the unknown AND restates the closed set (D4)', async () => {
  const unknown = capture(() => parseBatonCli(['run', 'scratchpad', 'bogus']));
  stageAssert(unknown.ok === false
    && /bogus/u.test(unknown.error?.message ?? '')
    && /read\|elevate\|append/u.test(unknown.error?.message ?? ''),
    'unknown-subverb-teaching-missing',
    `\`run scratchpad bogus\` must name bogus as unknown AND restate the closed set read|elevate|append (D4, surface-audit-cli.md §3 E-14); at HEAD the throw is "${
      unknown.error?.message ?? 'no throw'}"`);
});

// ---------------------------------------------------------------------------
// A10 — admission coherence (the #153 three-way, extended): no #157 ghost
// ---------------------------------------------------------------------------

test('A10-1 stage[append-admission-incoherent]: the append verb is coherently admitted — parser + CLI_WEB_COMMANDS + web four-table + MCP + semantic registry, with no surface advertised-but-dead', async (t) => {
  await hostFixture(t);
  // (a) CLI parser
  const parsed = capture(() => parseBatonCli(['run', 'scratchpad', 'append', 'run:m1', '--scope', 'shared', '--kind', 'note', '--body', 'x']));
  stageAssert(parsed.ok, 'append-admission-incoherent',
    'the CLI parser serves run.scratchpad.append (A10a); at HEAD the parser throws, so the verb is absent from every surface');
  // (b) CLI_WEB_COMMANDS (application-cli.mjs:16-32)
  const cliWebRegion = grepLines('application-cli.mjs', "run\\.scratchpad\\.append");
  stageAssert(cliWebRegion.some((row) => row.line < 40), 'append-admission-incoherent',
    'the verb is in CLI_WEB_COMMANDS (application-cli.mjs:16-32) — the CLI/web shared admission set (A10b)');
  // (c) web four-table (H2.1)
  const webSrc = readFileSync(fileURLToPath(new URL('../src/web-northbound.mjs', import.meta.url)), 'utf8');
  stageAssert(/run_scratchpad_append/u.test(webSrc), 'append-admission-incoherent',
    'the verb is on the web bus via the four-table direct-port admission incl. WEB_DIRECT_PORT_COMMANDS (A10c, H2.1)');
  // (d) MCP — TOOL_DEFINITIONS + ORDINARY_EXPLICIT_TOOLS + the _dispatch chain (H2.2)
  stageAssert(mcpApplicationToolNames().includes('baton_run_scratchpad_append'), 'append-admission-incoherent',
    'the verb is on MCP (A10d) — admitted in TOOL_DEFINITIONS + ORDINARY_EXPLICIT_TOOLS + the _dispatch chain, so a tools/call never lands dead');
  // (e) semantic-registry row + docs (D2)
  stageAssert(grepLines('application-semantics.mjs', "run\\.scratchpad\\.append").length > 0, 'append-admission-incoherent',
    'the verb has a semantic-registry row (application-semantics.mjs:1678-1695) — the surface inventory stays honest (A10e)');
});

// ---------------------------------------------------------------------------
// PIN rows — green at HEAD; each kills a plausible WRONG implementation.
// ---------------------------------------------------------------------------

test('P-A1 PIN: the read/elevate half of the parity table stays served — CLI parser + CLI_WEB_COMMANDS + MCP + registry all agree (the substrate the write completes)', () => {
  // The write verb completes the parity table (control-surface-audit.md:85), it never displaces the
  // served read/elevate half. A wrong impl that regresses read/elevate while adding append fails.
  const read = capture(() => parseBatonCli(['run', 'scratchpad', 'read', 'run:m1', '--scope', 'shared']));
  assert.equal(read.ok, true, 'run.scratchpad.read still parses');
  assert.equal(read.value?.name, 'run.scratchpad.read', 'read stays served');
  const elevate = capture(() => parseBatonCli(['run', 'scratchpad', 'elevate', 'run:m1', '--task', 'task:m1', '--entries', '[]']));
  assert.equal(elevate.ok, true, 'run.scratchpad.elevate still parses');
  assert.equal(elevate.value?.name, 'run.scratchpad.elevate', 'elevate stays served');
  const cliWeb = readFileSync(fileURLToPath(new URL('../src/application-cli.mjs', import.meta.url)), 'utf8');
  const setRegion = cliWeb.slice(cliWeb.indexOf('CLI_WEB_COMMANDS'), cliWeb.indexOf('CLI_WEB_COMMANDS') + 1200);
  assert.ok(/run\.scratchpad\.read/u.test(setRegion), 'read is in CLI_WEB_COMMANDS');
  assert.ok(/run\.scratchpad\.elevate/u.test(setRegion), 'elevate is in CLI_WEB_COMMANDS');
  const mcpNames = mcpApplicationToolNames();
  assert.ok(mcpNames.includes('baton_run_scratchpad_read') && mcpNames.includes('baton_run_scratchpad_elevate'),
    'read/elevate are served on MCP (mcp-northbound.mjs:652-668)');
  const sem = readFileSync(fileURLToPath(new URL('../src/application-semantics.mjs', import.meta.url)), 'utf8');
  assert.ok(sem.includes("'run.scratchpad.read'") && sem.includes("'run.scratchpad.elevate'"),
    'read/elevate have semantic-registry rows (application-semantics.mjs:1678-1695)');
});

test('P-A4 PIN: the kernel _byKey replay binding has NO scope term — the two-scope namespacing is the SURFACE\'s job (H3.1), never a kernel-envelope amendment', () => {
  // The kernel writeScratchpad envelope is CLOSED (G9/G10) — H3.1 chose surface namespacing
  // (auth.key = `${callerKey}:${scope}`) over amending the kernel's _byKey binding
  // (coordination-store.mjs:14086-14102). A wrong impl that adds a scope term to the kernel replay
  // check is killed here.
  const writeStart = srcAnchor('coordination-store.mjs', 'writeScratchpad\\(fields, auth\\)');
  const region = grepLines('coordination-store.mjs', 'prior\\.payload\\?\\.[A-Za-z]+')
    .filter((row) => row.line >= writeStart.line && row.line < writeStart.line + 100);
  assert.ok(region.length >= 2, 'the writeScratchpad _byKey binding carries the replay terms');
  const names = region.flatMap((row) => [...row.text.matchAll(/prior\.payload\?\.([A-Za-z]+)/gu)].map((m) => m[1]));
  assert.ok(!names.includes('scope'),
    'the kernel _byKey replay binding has no scope term — the two-scope verb is disambiguated by the SURFACE namespacing (H3.1, OQ2), never by amending the closed writeScratchpad envelope (G9/G10)');
});

test('P-A5 PIN: the deployment seam no longer wires the permissive `authorize: async () => true,` literal — the read-law restrictor stays the shipped default', () => {
  // The swarm read law (D1.2) shipped a restricting authorize at the deployment seam
  // (application-deployment.mjs:2041). A wrong impl that reverts the seam to the permissive literal
  // while adding append would silently unguard every read too — killed here.
  const permissive = grepLines('application-deployment.mjs', 'authorize: async \\(\\) => true,');
  assert.equal(permissive.length, 0,
    'the deployment seam must not wire the permissive `authorize: async () => true,` literal — the D1.2 read restrictor stays installed (application-deployment.mjs:2041), and the append restrictor must land on the same seam');
});

test('P-A6 PIN: the _authorize seam is byte-stable at application.mjs:3222 and the read verb passes {scope} at :13097 — the seam the append verb mirrors', () => {
  const seam = srcAnchor('application.mjs', '^  async _authorize\\(');
  assert.ok(seam.line > 3200 && seam.line < 3240, 'the _authorize def sits at :3214 (the seam the contract names)');
  const throwSite = srcAnchor('application.mjs', "throw applicationError\\('application command is not authorized', 'application_unauthorized'\\)");
  assert.equal(throwSite.line, 3222, 'the typed throw is byte-stable at :3222 — the D1 refusal is application_unauthorized at the seam, exactly as the sibling-refusal leg uses it (contract-fold.md:419)');
  const readAuthorize = srcAnchor('application.mjs', "await this\\._authorize\\('run\\.scratchpad\\.read'");
  assert.ok(readAuthorize.line === 13097, 'the read verb passes {scope} at :13097 — the pattern the append verb mirrors (the surface verb passes {scope} to _authorize(\'run.scratchpad.append\', principal, runId, {scope}))');
});

test('P-A7 PIN: the kernel bounds sit at the declared constants — the surface exposes them verbatim, never new numbers', () => {
  // Every bound the append verb honors is an existing declared constant (#89 FRAME_LIMITS registry,
  // coordination-store.mjs caps). A wrong impl that hardcodes a new cap or changes a declared one
  // is killed here.
  assert.equal(WORKER_CAP, 128, 'MAX_SCRATCHPAD_WORKER_ENTRIES stays 128 (coordination-store.mjs:524)');
  assert.equal(SHARED_CAP, 512, 'MAX_SCRATCHPAD_SHARED_ENTRIES stays 512 (coordination-store.mjs:525)');
  const bodyRow = FRAME_LIMITS['scratchpad.entry.body'];
  assert.equal(bodyRow.value, 8192, 'scratchpad.entry.body stays 8192 B (limits.mjs:71)');
  assert.equal(bodyRow.refusalCode, 'scratchpad_entry_exceeded', 'the body limit refusal is the single typed code the surface must expose verbatim (OQ4)');
  const partitionRefusal = grepLines('coordination-store.mjs', "'scratchpad_partition_exhausted'");
  assert.ok(partitionRefusal.some((row) => row.line >= 14100 && row.line <= 14120),
    'the worker-partition cap refusal sits at writeScratchpad :14106-14107 — the code the surface must expose for the 129th worker append (A7-3)');
});

test('P-A10 PIN: no #157 ghost TODAY — for the served read/elevate verbs the parser ⇔ CLI_WEB_COMMANDS ⇔ MCP ⇔ registry all agree', () => {
  // The #157 ghost is a surface that ADVERTISES a verb without SERVING it. Today read/elevate are
  // coherent (parser serves ⇔ CLI_WEB_COMMANDS lists ⇔ MCP admits ⇔ registry rows). A wrong impl
  // that admits append on one surface but forgets another reproduces the ghost the A10 coherence
  // pin exists to catch — and the SHIPPED verbs must stay coherent while append lands.
  const parserServed = ['run.scratchpad.read', 'run.scratchpad.elevate'];
  for (const name of parserServed) {
    const sub = name.split('.')[2];
    // The read branch takes --scope/--cursor; the elevate branch takes --task/--entries
    // (application-cli.mjs:1476-1511). Each verb's OWN arg closure must parse.
    const argv = sub === 'elevate'
      ? ['run', 'scratchpad', 'elevate', 'run:m1', '--task', 'task:m1', '--entries', '[]']
      : ['run', 'scratchpad', sub, 'run:m1', '--scope', 'shared'];
    const parsed = capture(() => parseBatonCli(argv));
    assert.equal(parsed.ok, true, `${name} is served by the CLI parser`);
  }
  const cliWeb = readFileSync(fileURLToPath(new URL('../src/application-cli.mjs', import.meta.url)), 'utf8');
  const setRegion = cliWeb.slice(cliWeb.indexOf('CLI_WEB_COMMANDS'), cliWeb.indexOf('CLI_WEB_COMMANDS') + 1200);
  const mcpNames = mcpApplicationToolNames();
  const sem = readFileSync(fileURLToPath(new URL('../src/application-semantics.mjs', import.meta.url)), 'utf8');
  for (const name of parserServed) {
    assert.ok(setRegion.includes(name), `${name} is listed in CLI_WEB_COMMANDS`);
    const tool = `baton_${name.replaceAll('.', '_')}`;
    assert.ok(mcpNames.includes(tool), `${name} is admitted on MCP (${tool})`);
    assert.ok(sem.includes(`'${name}'`), `${name} has a semantic-registry row`);
  }
});
