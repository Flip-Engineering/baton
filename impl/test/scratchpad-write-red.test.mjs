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
// Rows: 23 (18 red + 5 pin). Red-first: every red row fails today at a NAMED stage and goes green
// on the #158 implementation ONLY — never on a hardcoded fixture or a shallow per-surface admit.
// The five pin rows are green today AND under the correct implementation, but fail a plausible
// WRONG one (each pin names the wrong implementation it kills). Fold (blueteam-158 §6.7): the
// former P-A10 was redundant with P-A1 (both bite the read/elevate coherence sweep; the shared
// read-branch-disable mutation flips both simultaneously — proven in blueteam §8.3) and its A10
// namesake is the RED A10-1 row, so it is MERGED into P-A1 and the suite drops to 23 rows.
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
//   P-A6  the _authorize seam keeps its structural order — def before the typed refusal throw before
//         the read verb's {scope} call — the seam the append verb mirrors (folded from byte-pins to
//         relative order per the blueteam §4 law)
//   P-A7  the kernel bounds sit at the declared constants (128/512 caps, 8192 B body, the typed
//         scratchpad_partition_exhausted / scratchpad_entry_exceeded refusals) — the surface exposes
//         them verbatim
//
// RED/GREEN split at HEAD e371f70 (recorded after TWO consecutive runs from the repo root;
// `node --test impl/test/scratchpad-write-red.test.mjs` — 23 rows, 5 pass / 18 fail, identical
// across both runs; the fold dropped the redundant P-A10):
//   RED   18 — A1-1, A1-2, A2-1, A2-2, A2-3, A3-1, A3-2, A4-1, A4-2, A5-1, A6-1, A7-1, A7-2,
//              A7-3, A8-1, A9-1, A9-2, A10-1   (each fails at its named stage)
//   GREEN  5 — P-A1, P-A4, P-A5, P-A6, P-A7
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
    // Watchdog (the fold-suite law checklist): the driver is armed with a stall watchdog
    // (stallMs 60_000, kill-on-stall) exactly as worker-orchestrated-swarm-red.test.mjs does.
    // This suite never launches the interpreter loop (it drives application.command / Web /
    // MCP directly), so the watchdog can never fire — it exists to keep the driver construction
    // honest against the deployment profile, and is the blueteam-158 §4.5 checklist closure.
    watchdog: { stallMs: 60_000, loopThreshold: 0, scopeAction: 'kill' },
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

// The blueteam-158 §3.1/§3.5 comment-flip fold: a STRUCTURAL grep must pin CODE, never a comment.
// A wrong impl that hides a removed branch (or fakes a present one) behind a comment no longer
// satisfies a bare text grep. Uses grepLines (NUL-safe) so it works on application.mjs /
// coordination-store.mjs too.
function codeLines(file, pattern) {
  return grepLines(file, pattern).filter((row) => {
    const trimmed = row.text.trimStart();
    return trimmed !== '' && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*');
  });
}

// Token-bound region read (the A2-3/A3-2/A10-1/P-A1 fold): read a NUL-free source whole and slice
// between two literal tokens — no absolute line window, no +N offset. Callers must only use this
// on the NUL-free files (application-cli.mjs, mcp-northbound.mjs, web-northbound.mjs,
// application-deployment.mjs, application-semantics.mjs, limits.mjs).
function regionBetween(file, startToken, endToken) {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const src = readFileSync(join(root, file), 'utf8');
  const s = src.indexOf(startToken);
  const e = src.indexOf(endToken, s + 1);
  return s === -1 || e === -1 ? '' : src.slice(s, e);
}

// Window-free brace-bounded region enclosing the restrictor factory an anchor line lives in (the
// A5-1 law-3 posture fold — the blueteam-sanctioned "restrictor factory" structural pin). Walks
// back to the nearest `function NAME(` / `const NAME = (` signature, then forward counting braces
// to the matching close. NUL-free file only.
function enclosingFactoryRegion(file, anchorLine) {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const lines = readFileSync(join(root, file), 'utf8').split('\n');
  let start = anchorLine - 1;
  while (start >= 0) {
    if (/^\s*(?:async\s+)?function\b/u.test(lines[start])
      || /^\s*const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\(/u.test(lines[start])) break;
    start--;
  }
  if (start < 0) start = anchorLine - 1;
  let depth = 0;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const text = lines[i] ?? '';
    out.push(text);
    depth += (text.match(/\{/gu) ?? []).length - (text.match(/\}/gu) ?? []).length;
    if (depth <= 0 && i > start) break;
  }
  return out.join('\n');
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
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
  // Fold (blueteam A1-1 SHALLOW bite): the branch must not special-case ONE argv shape — a second
  // member append with a different runId/scope/body resolves to its own closed closure.
  const second = capture(() => parseBatonCli([
    'run', 'scratchpad', 'append', 'run:m2', '--scope', 'worker:m2', '--kind', 'note', '--body', 'second note',
  ]));
  stageAssert(second.ok, 'cli-append-branch-missing',
    'the append branch serves a second argv shape — a hardcoded first-shape special case is killed');
  assert.deepEqual(second.value.args, {
    runId: 'run:m2', scope: 'worker:m2', kind: 'note', body: 'second note',
  }, 'the closed arg closure holds for a different member scope');
  // Fold (blueteam A1-1 SHALLOW bite): the parser validates --scope against the closed set
  // (shared | worker:ID) exactly as the read branch does (application-cli.mjs:1482-1484) — an
  // unvalidating flag passthrough is killed.
  const badScope = capture(() => parseBatonCli([
    'run', 'scratchpad', 'append', 'run:m1', '--scope', 'bogus', '--kind', 'note', '--body', 'x',
  ]));
  stageAssert(badScope.ok === false && badScope.error?.code === 'cli_invalid',
    'cli-append-branch-missing',
    'a scope outside the closed {shared, worker:<id>} set refuses cli_invalid — the append branch mirrors the read branch\'s scope validation (H2.3)');
  // GREEN condition stated: a `shared` receipt depends on the unlanded tight-cell shared-write
  // kernel path (tight-cell-contract.md:808 "today: orchestrator elevation only") — this pin does
  // not hide that kernel dependency (A1 GREEN condition).
  assert.equal(parsed.value.args.kind, 'note', '--kind note exercises the CLI text body (A1)');
});

test('A1-2 stage[cli-append-json-shape-missing]: the non-note JSON body path parses into the closed per-kind shape (H2.3)', async () => {
  // The positive leg rides a plan body that the kernel's CLOSED plan shape accepts
  // (normalizeScratchpadEntry: {objective, steps:[{text, state}]} with state in
  // todo|doing|done, coordination-store.mjs:620-641) — the original `steps:["a","b"]` body was a
  // kernel-INVALID plan entry a correct H2.3 parser must refuse, so it moved to the refusal leg.
  const plan = capture(() => parseBatonCli([
    'run', 'scratchpad', 'append', 'run:m1', '--scope', 'worker:m1', '--kind', 'plan',
    '--body', '{"objective":"plan it","steps":[{"text":"a","state":"todo"},{"text":"b","state":"doing"}]}',
  ]));
  stageAssert(plan.ok, 'cli-append-json-shape-missing',
    `the CLI must JSON-parse the non-note body into the kernel's closed per-kind shape (normalizeScratchpadEntry, coordination-store.mjs:607-696) and refuse a malformed body with cli_invalid naming the expected shape (H2.3, mirroring the elevate branch's --entries handling); at HEAD the parser throws ${
      plan.error?.message ?? plan.error?.code ?? '?'}`);
  assert.equal(plan.value.name, 'run.scratchpad.append', 'the plan append parses to the append verb');
  assert.equal(plan.value.args.scope, 'worker:m1', 'a member may target its own worker:<ownId> partition');
  assert.deepEqual(plan.value.args.body, {
    objective: 'plan it',
    steps: [{ text: 'a', state: 'todo' }, { text: 'b', state: 'doing' }],
  }, 'the plan body rides the closed {objective, steps:[{text,state}]} shape');
  const bad = capture(() => parseBatonCli([
    'run', 'scratchpad', 'append', 'run:m1', '--scope', 'worker:m1', '--kind', 'plan', '--body', 'not-json',
  ]));
  stageAssert(bad.ok === false && /cli_invalid|JSON/u.test(bad.error?.message ?? ''), 'cli-append-json-shape-missing',
    'a malformed non-note body refuses cli_invalid naming the expected JSON shape (H2.3) — never a silent string');
  // Fold (blueteam A1-2 SHALLOW bite): a VALID-JSON body with the WRONG per-kind shape refuses
  // cli_invalid naming the expected shape — a passthrough `JSON.parse` (no shape validation
  // against normalizeScratchpadEntry) accepts it, so it is killed.
  const wrongShape = capture(() => parseBatonCli([
    'run', 'scratchpad', 'append', 'run:m1', '--scope', 'worker:m1', '--kind', 'plan',
    '--body', '{"objective":"plan it","steps":["a","b"]}',
  ]));
  stageAssert(wrongShape.ok === false && /cli_invalid|plan/u.test(wrongShape.error?.message ?? ''),
    'cli-append-json-shape-missing',
    'a plan body whose steps are strings (not [{text,state}]) refuses cli_invalid naming the expected plan shape (H2.3) — never a silent string');
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
  // Round-trip read-back (the blueteam F5 fold): the dispatched append must WRITE — a surface
  // that fabricates a receipt (or routes through dead plumbing) without writing fails the kernel
  // read-back. At HEAD the stage assert above fires first, so this only runs under a working
  // dispatch (and pins the write, not just the receipt).
  const snap = host.driver.coordination.scratchpadSnapshot('run:m1', 'worker:m1');
  stageAssert(snap.slices[0].entries.some((e) => e.content?.text === 'hello' || e.text === 'hello'),
    'mcp-append-dispatch-branch-missing',
    'the dispatched append lands a WRITTEN entry in the kernel worker:<ownId> partition (scratchpadSnapshot read-back) — an advertised-but-dead or fabricated-receipt dispatch fails here');
});

test('A2-3 stage[mcp-append-admission-missing]: TOOL_DEFINITIONS + ORDINARY_EXPLICIT_TOOLS + the _dispatch chain all reference the tool', async () => {
  // TOOL_DEFINITIONS (mcp-northbound.mjs:830) is the union of the ordinary/application/advanced/
  // reflex tables; the append tool must land in APPLICATION_TOOL_DEFINITIONS (:652-668) beside
  // read/elevate so the pinned enumeration and the typed-failure lane both see it.
  const toolDef = grepLines('mcp-northbound.mjs', "name: 'baton_run_scratchpad_append'");
  stageAssert(toolDef.length > 0, 'mcp-append-admission-missing',
    'the append tool must be admitted in APPLICATION_TOOL_DEFINITIONS (mcp-northbound.mjs:652-668) — beside baton_run_scratchpad_read/elevate');
  // Fold (blueteam A2-3 + law re-check): the ORDINARY_EXPLICIT_TOOLS leg drops the absolute
  // `700 < line < 900` window for a token-region read of the set (mcp-northbound.mjs:822-829).
  const explicitRegion = regionBetween('mcp-northbound.mjs', 'const ORDINARY_EXPLICIT_TOOLS', ']);');
  stageAssert(/baton_run_scratchpad_append/u.test(explicitRegion), 'mcp-append-admission-missing',
    'the append tool must be admitted in ORDINARY_EXPLICIT_TOOLS (mcp-northbound.mjs:822-829) — the typed-failure lane — so a tool error never degrades to a bare protocolError');
  // Fold (blueteam A2-3 BROKEN-on-platform): the dispatch grep's parens are ESCAPED — in ERE the
  // unescaped `(name === …)` is a GROUP that can never match the literal branch text (verified
  // against the EXISTING read branch at mcp-northbound.mjs:1900); a fully-correct _dispatch branch
  // was unreachable-green on darwin's BSD grep.
  const dispatch = grepLines('mcp-northbound.mjs', "else if \\(name === 'baton_run_scratchpad_append'\\)");
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
  // Round-trip read-back (the blueteam F5 fold): the dispatched append must WRITE — a canned
  // fabricated receipt (blueteam A3-1 bite) fails the kernel read-back. At HEAD the stage asserts
  // above fire first, so this only runs under a working dispatch.
  const snap = host.driver.coordination.scratchpadSnapshot('run:m1', 'worker:m1');
  stageAssert(snap.slices[0].entries.some((e) => e.content?.text === 'hello' || e.text === 'hello'),
    'web-append-dispatch-missing',
    'the dispatched append lands a WRITTEN entry in the kernel worker:<ownId> partition (scratchpadSnapshot read-back) — a fabricated receipt with zero writes fails here');
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
  // Fold (blueteam A3-2 fixture-fragility): WEB_DIRECT_PORT_COMMANDS is DERIVED from WAVE_WEB_ENTRIES
  // (`new Set(WAVE_WEB_ENTRIES.map(([transport]) => transport))`, web-northbound.mjs:62), so the
  // append transport must land in WAVE_WEB_ENTRIES — the old `table('const WEB_DIRECT_PORT_COMMANDS',
  // '// ')` truncated at the first comment token and could never see a derived transport.
  const waveEntriesRegion = table('const WAVE_WEB_ENTRIES', ']);');
  stageAssert(/run_scratchpad_append/u.test(capabilityRegion), 'web-append-admission-missing',
    'COMMAND_CAPABILITY (web-northbound.mjs:87-94) must carry run_scratchpad_append — the admission is four tables, and a missing capability row is a #157 ghost');
  stageAssert(/run_scratchpad_append/u.test(argFieldsRegion), 'web-append-admission-missing',
    'ARG_FIELDS/ACCEPTED_ARG_FIELDS (web-northbound.mjs:112-148) must carry the closed {runId, scope, kind, body, idempotencyKey} accepted set');
  stageAssert(/run_scratchpad_append/u.test(applicationCommandRegion), 'web-append-admission-missing',
    'APPLICATION_COMMAND (web-northbound.mjs:149-151) must route run_scratchpad_append to the application command');
  stageAssert(/run_scratchpad_append/u.test(waveEntriesRegion), 'web-append-admission-missing',
    'WAVE_WEB_ENTRIES (web-northbound.mjs:37-47) — the direct-port source WEB_DIRECT_PORT_COMMANDS is derived from — must carry run_scratchpad_append (H2.1, the FOURTH table); at HEAD only the waves_* transports are admitted, so every append envelope is refused `unsupported command` before the dispatch');
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
  // write law is unwritten. Fold (blueteam A4-1 SHALLOW): the seam pin is STRUCTURAL — the verb must
  // appear in deployment CODE (comment-flip killed), and the authorize install site must wire a
  // restrictor FACTORY call (the blueteam-sanctioned "restrictor factory + install site" wiring).
  stageAssert(codeLines('application-deployment.mjs', 'run\\.scratchpad\\.append').length > 0,
    'append-restrictor-missing',
    'the deployment must install an append restrictor whose policy references run.scratchpad.append in CODE (the D1 write law — comment-flip resistant); at HEAD no append restrictor exists, so a cross-partition append would resolve');
  stageAssert(codeLines('application-deployment.mjs', 'authorize:\\s*[A-Za-z_$][\\w$]*\\s*\\(').length > 0,
    'append-restrictor-missing',
    'the authorize install site (application-deployment.mjs:2041) must wire a restrictor factory call — the D1 write law lands on the same seam as the D1.2 read restrictor, never a raw permissive literal');
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
  // seam, not merely stated (H1.1 blocker 3). Fold (blueteam A4-2 SHALLOW): the wiring is pinned in
  // CODE — a comment or an unrelated `_getWorker` mention no longer satisfies it.
  stageAssert(codeLines('application-deployment.mjs', '_getWorker').length > 0,
    'own-run-predicate-missing',
    'the append restrictor must be constructed with a seat-resolver closure (the coordinator _getWorker binding) so the D1 own-run predicate is ENFORCED at the seam (H1.1 blocker-3 wiring — comment-flip resistant); at HEAD no append restrictor exists at the deployment seam at all');
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
  // RED — the deployment seam installs the append restrictor. Fold (blueteam A5-1 SHALLOW): the
  // law-3 POSTURE is pinned structurally inside the restrictor factory — the policy region names
  // the review authority (local-owner / service-*) AND refuses it on a member partition, the
  // STRICTER-than-read write posture (the D1.2 read restrictor GRANTS the review authority any
  // member scope at application-deployment.mjs:1737). At HEAD no append restrictor exists, so the
  // review authority's append posture is undefined (permissive).
  const verbRefs = codeLines('application-deployment.mjs', 'run\\.scratchpad\\.append');
  stageAssert(verbRefs.length > 0, 'review-authority-append-missing',
    'the deployment must install the append restrictor carrying law 3 — a STRICTER posture than the D1.2 read law; at HEAD no append restrictor exists, so the review authority\'s append posture is undefined (permissive)');
  const policyRegion = stripComments(enclosingFactoryRegion('application-deployment.mjs', verbRefs[0].line));
  stageAssert(/local-owner|service-|review/u.test(policyRegion), 'review-authority-append-missing',
    'the append restrictor\'s policy names the review authority (local-owner / service-*) — law 3\'s shared-only posture is a real branch, not the permissive default');
  stageAssert(/(?:local-owner|service-|review)[^\n]{0,120}return false|return false[^\n]{0,120}(?:local-owner|service-|review)/u.test(policyRegion),
    'review-authority-append-missing',
    'the append restrictor\'s policy REFUSES the review authority on a member partition (law 3\'s shared-only strictness — the write posture diverges from the D1.2 read restrictor\'s `return true` grant); a restrictor that reuses the read posture or stays permissive fails here');
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
  const appendBranch = codeLines('application.mjs', "name === 'run.scratchpad.append'");
  stageAssert(appendBranch.length > 0, 'append-candidacy-shortcut-missing',
    'the append verb must land in the direct-port dispatch block as an ephemeral shared write (D1 law 4, tight-cell-contract.md:818-822) — never a scratch-fact/KG candidacy shortcut; at HEAD the branch is absent (the verb is unwritten). GREEN condition: a direct shared write exists only via the unlanded tight-cell shared-write kernel path (G8)');
  // The ephemeral discriminator (the blueteam A6-1 fold): the branch must be CODE (comment-flip
  // killed above), its OWN direct port (not the elevate branch — which routes to scratchpadElevate),
  // and its dispatch must NOT route to the elevation/candidacy lane.
  const elevateDispatch = srcAnchor('application.mjs', "name === 'run.scratchpad.elevate'");
  stageAssert(appendBranch[0].line !== elevateDispatch.line,
    'append-candidacy-shortcut-missing',
    'the append branch must be its OWN direct port, never an alias of the elevate branch — a shared append needs no elevation (law 4)');
  stageAssert(!/scratchpadElevate|elevateTaskScratchpad/u.test(appendBranch[0].text),
    'append-candidacy-shortcut-missing',
    'the append branch routes to an EPHEMERAL write method — never scratchpadElevate/elevateTaskScratchpad (the direct-port branches are single-line `return this.X(args, principal)` dispatches, application.mjs:12514-12523) — a shallow impl that aliases append onto the elevation lane fails (law 4)');
});

// ---------------------------------------------------------------------------
// A7 — D3 bounds through the surface (OQ4, G8)
// ---------------------------------------------------------------------------

test('A7-1 stage[append-body-limit-missing]: a body over scratchpad.entry.body (8192 B for a steering-registered run) refuses scratchpad_entry_exceeded', async (t) => {
  const fx = await lawFixture(t);
  const limit = FRAME_LIMITS['scratchpad.entry.body'].value;
  // Fold (blueteam A7-1 SHALLOW): the under-bound half is pinned FIRST — a blanket
  // scratchpad_entry_exceeded refusal (the bite-tested cheap wrong impl) would fail the written
  // receipt, and the round-trip read-back proves the surface actually WRITES. At HEAD the first
  // command throws (application_command_unavailable), so this stage assert is the RED gate.
  const under = await captureAsync(fx.application.command('run.scratchpad.append',
    { runId: 'run:steer', scope: 'shared', kind: 'note', body: 'within limit', idempotencyKey: 'ik-a7-under' },
    principal('worker:m1')));
  stageAssert(under.ok && under.value?.result === 'written', 'append-body-limit-missing',
    `the append surface must WRITE a note under the body limit (receipt result:"written"); at HEAD the surface is absent and the command throws ${
      under.error?.code ?? '?'} (application_command_unavailable)`);
  const readBack = fx.driver.coordination.scratchpadSnapshot('run:steer', 'shared');
  stageAssert(readBack.slices[0].entries.some((e) => e.content?.text === 'within limit' || e.text === 'within limit'),
    'append-body-limit-missing',
    'the written note is READ BACK from the kernel shared partition (scratchpadSnapshot) — a surface that fabricates receipts without writing fails here (the blueteam round-trip fold)');
  const body = 'x'.repeat(limit + 1);
  const attempt = await captureAsync(fx.application.command('run.scratchpad.append',
    { runId: 'run:steer', scope: 'shared', kind: 'note', body },
    principal('worker:m1')));
  stageAssert(attempt.ok === false && attempt.error?.code === 'scratchpad_entry_exceeded',
    'append-body-limit-missing',
    `the append surface must expose the kernel's single refusal verbatim — a body over ${limit} B refuses scratchpad_entry_exceeded (OQ4: the 8192/2048 steering split is a doc note, never a second surface code)`);
});

test('A7-2 stage[append-shared-cap-missing]: the 513th shared append refuses scratchpad_partition_exhausted', async (t) => {
  const fx = await lawFixture(t);
  // Fold (blueteam A7-2 BROKEN — inert fixture): the shared partition is pre-FILLED to the cap
  // with distinct idempotency keys (each append provably writes), so the (cap+1)th append is a
  // REAL 513th — not a fresh-partition entry #1 that a correct impl would write successfully.
  // At HEAD the FIRST fill throws (no append surface), so this stage assert is the RED gate.
  for (let i = 0; i < SHARED_CAP; i++) {
    const fill = await captureAsync(fx.application.command('run.scratchpad.append',
      { runId: 'run:steer', scope: 'shared', kind: 'note', body: `fill ${i}`, idempotencyKey: `ik-shared-${i}` },
      principal('worker:m1')));
    stageAssert(fill.ok && fill.value?.result === 'written', 'append-shared-cap-missing',
      `fill ${i}/${SHARED_CAP}: each shared append writes (result:"written") — the partition must be provably FILLED before the cap is tested; at HEAD the first fill throws ${
        fill.error?.code ?? '?'} (application_command_unavailable)`);
  }
  const attempt = await captureAsync(fx.application.command('run.scratchpad.append',
    { runId: 'run:steer', scope: 'shared', kind: 'note', body: `entry ${SHARED_CAP + 1}` },
    principal('worker:m1')));
  stageAssert(attempt.ok === false && attempt.error?.code === 'scratchpad_partition_exhausted',
    'append-shared-cap-missing',
    `the ${SHARED_CAP + 1}th shared append must refuse scratchpad_partition_exhausted (the declared 512-entry shared cap, coordination-store.mjs:525; H1.4 — the shared tier is a disclosed shared drain). GREEN condition: the shared-write path is the unlanded tight-cell shared-write kernel mechanism (G8)`);
});

test('A7-3 stage[append-worker-cap-missing]: the 129th worker:<ownId> append refuses scratchpad_partition_exhausted', async (t) => {
  const fx = await lawFixture(t, { 'worker:m1': 'run:m1' });
  // Fold (blueteam A7-3 BROKEN — inert fixture): the worker partition is pre-FILLED to the cap
  // with distinct idempotency keys before the capped append — a real 129th, not a fresh entry #1.
  for (let i = 0; i < WORKER_CAP; i++) {
    const fill = await captureAsync(fx.application.command('run.scratchpad.append',
      { runId: 'run:m1', scope: 'worker:m1', kind: 'note', body: `fill ${i}`, idempotencyKey: `ik-worker-${i}` },
      principal('worker:m1')));
    stageAssert(fill.ok && fill.value?.result === 'written', 'append-worker-cap-missing',
      `fill ${i}/${WORKER_CAP}: each worker:<ownId> append writes (result:"written") — the partition must be provably FILLED before the cap is tested; at HEAD the first fill throws ${
        fill.error?.code ?? '?'} (application_command_unavailable)`);
  }
  const attempt = await captureAsync(fx.application.command('run.scratchpad.append',
    { runId: 'run:m1', scope: 'worker:m1', kind: 'note', body: `entry ${WORKER_CAP + 1}` },
    principal('worker:m1')));
  stageAssert(attempt.ok === false && attempt.error?.code === 'scratchpad_partition_exhausted',
    'append-worker-cap-missing',
    `the ${WORKER_CAP + 1}th worker:<ownId> append must refuse scratchpad_partition_exhausted (MAX_SCRATCHPAD_WORKER_ENTRIES=128, coordination-store.mjs:524; the kernel refusal at :14106-14107)`);
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
  // Round-trip read-back (the blueteam F5 fold, MUT-17 killed): the first write must land in the
  // kernel worker:<ownId> partition — a session-scoped surface replay Map that fabricates receipts
  // without touching the kernel's durable _byKey shows NO entry here.
  const firstSnap = fx.driver.coordination.scratchpadSnapshot('run:m1', 'worker:m1');
  stageAssert(firstSnap.slices[0].entries.some((e) => e.content?.text === 'hi' || e.text === 'hi'),
    'append-replay-scope-missing',
    'the first append lands a WRITTEN entry in the kernel worker:<ownId> partition (scratchpadSnapshot read-back) — a fabricated surface replay Map (never writing) fails here');
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
  // Round-trip read-back of the SHARED partition too: the two-scope namespacing is real at the
  // store — the shared retry landed its own written entry, distinct from the worker entry.
  const crossSnap = fx.driver.coordination.scratchpadSnapshot('run:m1', 'shared');
  stageAssert(crossSnap.slices[0].entries.some((e) => (e.content?.text === 'hi' || e.text === 'hi')
      && e.entryId !== first.value?.entryId),
    'append-replay-scope-missing',
    'the shared retry lands a DISTINCT WRITTEN entry in the kernel shared partition (scratchpadSnapshot read-back) — the two-scope namespacing is real at the store (H3.1), not just a receipt claim');
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
  // (b) CLI_WEB_COMMANDS (application-cli.mjs:16-32) — the blueteam §4 law fold drops the absolute
  // `line < 40` bound for a token-region read of the set.
  const cliWebRegion = regionBetween('application-cli.mjs', 'const CLI_WEB_COMMANDS', ']);');
  stageAssert(/run\\.scratchpad\\.append/u.test(cliWebRegion), 'append-admission-incoherent',
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
  // Bluetema §4 law fold: the `+1200` char-offset window is a size-doubling absolute anchor — read the
  // set by its terminal token instead. (Subsumes the former P-A10 coherence pin.)
  const setRegion = regionBetween('application-cli.mjs', 'const CLI_WEB_COMMANDS', ']);');
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
  //
  // Bluetema §4 law fold: the `writeStart.line + 100` line-window is a line-count absolute anchor —
  // read the replay terms by their `!==` co-occurrence instead. The `!==` form is the _byKey
  // binding discriminator (`prior.payload?.scope !==` is 0 at HEAD; the REPL binding replay at
  // coordination-store.mjs:15606/15703 uses the `:` form and must not trip the absence check).
  const replayTerms = grepLines('coordination-store.mjs', 'prior\\.payload\\?\\.(runId|taskId|workerId|contentDigest) !==');
  assert.ok(replayTerms.length >= 2
    && ['runId', 'taskId', 'workerId', 'contentDigest'].every((term) => replayTerms.some((row) => row.text.includes(`prior.payload?.${term} !==`))),
    'the writeScratchpad _byKey binding carries the replay terms');
  assert.equal(grepLines('coordination-store.mjs', 'prior\\.payload\\?\\.scope !==').length, 0,
    'the kernel _byKey replay binding has no scope term — the two-scope verb is disambiguated by the SURFACE namespacing (H3.1, OQ2), never by amending the closed writeScratchpad envelope (G9/G10)');
});

test('P-A5 PIN: the deployment seam no longer wires the permissive `authorize: async () => true,` literal — the read-law restrictor stays the shipped default', () => {
  // The swarm read law (D1.2) shipped a restricting authorize at the deployment seam
  // (application-deployment.mjs:2041). A wrong impl that reverts the seam to the permissive literal
  // while adding append would silently unguard every read too — killed here.
  // Bluetema §4 law fold: widened via codeLines (a bare grep matched the `* literal authorize:
  // async () => true ...` doc comment at application-deployment.mjs:2073 — structural pins must hit
  // CODE only), and the pattern covers both the `async () =>` and bare `() =>` permissive forms.
  const permissive = codeLines('application-deployment.mjs', 'authorize:\\s*async\\s*\\(\\s*\\)\\s*=>\\s*true\\b|authorize:\\s*\\(\\s*\\)\\s*=>\\s*true\\b');
  assert.equal(permissive.length, 0,
    'the deployment seam must not wire the permissive `authorize: async () => true,` literal — the D1.2 read restrictor stays installed (application-deployment.mjs:2041), and the append restrictor must land on the same seam');
});

test('P-A6 PIN: the _authorize seam stays structurally ordered — _authorize def before its typed refusal throw before the read verb\'s {scope} call — the seam the append verb mirrors', () => {
  // Bluetema §4 law fold: the `>3200 && <3240` def-window and the `===13097` byte-pin are absolute
  // line anchors — the fold laws drop windows/byte-pins for RELATIVE order. Seam identity is kept by
  // the anchor patterns themselves (srcAnchor throws if any of the three disappears).
  const seam = srcAnchor('application.mjs', '^  async _authorize\\(');
  const throwSite = srcAnchor('application.mjs', "throw applicationError\\('application command is not authorized', 'application_unauthorized'\\)");
  const readAuthorize = srcAnchor('application.mjs', "await this\\._authorize\\('run\\.scratchpad\\.read'");
  assert.ok(seam.line < throwSite.line, 'the _authorize def sits above the typed refusal throw — the seam the contract names');
  assert.ok(throwSite.line < readAuthorize.line, 'the typed throw (the D1 refusal, application_unauthorized) sits above the read verb — the seam the append verb mirrors (the surface verb passes {scope} to _authorize(\'run.scratchpad.append\', principal, runId, {scope}))');
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
  // Bluetema §4 law fold: the `14100-14120` window is a line-range absolute anchor — drop it for a
  // presence check with a RELATIVE order bound (the refusal sites sit at 14107/14240, both below the
  // writeScratchpad def; the two anchors may move together, the order may not invert).
  const writeStart = srcAnchor('coordination-store.mjs', 'writeScratchpad\\(fields, auth\\)');
  const partitionRefusal = grepLines('coordination-store.mjs', "'scratchpad_partition_exhausted'");
  assert.ok(partitionRefusal.length > 0 && partitionRefusal.some((row) => row.line > writeStart.line),
    'the worker-partition cap refusal code sits below the writeScratchpad seam — the code the surface must expose for the 129th worker append (A7-3)');
});
