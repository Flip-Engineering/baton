// Issue #473 — `swarm.stop` of a seat whose run stop did not complete crossed the web layer as
// 503 `temporarily_unavailable`, because `coordinator_run_stop_incomplete` (the coordinator's own
// run-stop leg refusal) was not in the swarm family's closed refusal set. The resident's fallthrough
// narration named the fix itself: `baton-web dispatch fallthrough: command 'swarm_stop' raised the
// unmapped refusal code 'coordinator_run_stop_incomplete' and crossed as 503 temporarily_unavailable`.
//
// What this file pins:
//   (a) through the REAL served POST /v1/commands transport (#430's parity fixture lane), a
//       `swarm.stop` on a seat whose run stop stalls — the REAL `Coordinator.stopRunTargets` behind
//       the swarm runtime's injected `stopRun` port — crosses as `coordinator_run_stop_incomplete`
//       with HTTP 409 and the coordinator's own detail (the run the stop named, its deadline, and
//       the rows the leg is holding), never as the transient 503 row;
//   (b) the derivation pin over the coordinator's run-stop / kill / drain refusal sites AND — issue
//       #483 — over the coordination store's own wait-abort mint (`waitAfter`, the wait a bounded
//       `swarm.watch` holds): the roster is read from the modules' own code, every code the RUN-STOP
//       leg or the wait-abort leg raises is a row of `SWARM_REFUSAL_CODES`, and every other stop-path
//       code is classified with its crossing PROVEN through the same transport — a code added to any
//       of those legs fails this file until it is classified and mapped (the #430 narration exists
//       because this gap recurs, and this is what ends the recurrence; one table, one pin);
//   (c) the CLI prints the seat, the run and the wait under the refusal line, and the ONE next step
//       that converges the seat: wait for the deadline, or stop again after it.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore } from '../src/index.mjs';
import { parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { SWARM_REFUSAL_CODES } from '../src/swarm-refusals.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { memberSource } from './seam-member-source.mjs';
// The red-before HEAD has no rendering leg and no owner row: the rows below show their own red
// then, instead of the file failing to link before any of them runs.
let swarmStopRefusalBlock = null;
try { ({ swarmStopRefusalBlock } = await import('../src/application-cli.mjs')); } catch { /* red-before */ }

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue473-web';
const SWARM_ID = 's-issue473';
const SEAT_ID = 'seat-stall';
const STOP_TIMEOUT_MS = 200;

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue473-${label}-`));
  roots.push(root);
  return root;
}

class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}
async function send(web, { method = 'POST', path, body, headers = {}, encrypted = true }) {
  const req = new EventEmitter();
  Object.assign(req, {
    method, url: path, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    socket: { encrypted, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const res = new Response();
  const pending = web.handle(req, res);
  queueMicrotask(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  await pending;
  return res;
}
function applicationCard() {
  return { schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) };
}
const envelope = (overrides = {}) => ({
  schemaVersion: 1, commandId: 'issue473-cmd-1', idempotencyKey: 'issue473-key-1',
  command: 'run_status', args: { runId: 'run-issue473' }, repoId: REPO_ID, origin: ORIGIN,
  ...overrides,
});

// ── the fixture: a REAL coordinator whose run stop cannot converge ───────────────────────────────
// The refusal #473 reports is the coordinator's own, so the fixture drives the REAL run-stop leg
// (`stopRunTargets`) behind the swarm runtime's injected `stopRun` port: the same seam
// application.mjs wires (`stopRun: (runId, reason) => this.stop(runId, reason, …)`). The checkout
// refuses to go away and the adapter acks a kill it never confirms, so the leg sweeps its deadline
// with the workers it names still held — the non-convergence the resident's log recorded.

/** The WorktreeManager contract (spec §3.2), with a checkout that refuses to go away: the one hold
 * a stop cannot release, exactly as issue450's run-stop fixture spells it. */
class RefusingWorktreeManager {
  constructor() { this.calls = { remove: [] }; }
  async create(taskId) { return { path: `/tmp/issue473-wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }; }
  async capture() { return { sha: 'sha-result' }; }
  async remove(taskId) {
    this.calls.remove.push({ taskId });
    throw Object.assign(new Error('checkout is busy'), { code: 'worktree_busy' });
  }
  async reconcile() {}
  worktreeAvailable() { return true; }
}

/** The coordinator's own Adapter contract, scripted: spawn and kill are acked, and no terminal
 * event ever arrives, so the stop's convergence is the leg's own deadline. */
class ScriptedAdapter {
  constructor() { this.calls = { kill: [] }; this._onEvent = null; }
  card() { return { harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100_000, verbs: { spawn: 'native', interrupt: 'native' } }; }
  onEvent(cb) { this._onEvent = cb; }
  async spawn() { return { ok: true }; }
  async prompt() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; }
}

const bareBrief = (goal) => ({
  goal, constraints: [], pathScope: ['.'], definitionOfDone: 'tests pass',
  verification: { command: 'true', expectExit: 0 }, budget: { tokens: 100_000, usd: 5, wallMin: 30 },
});

/** The #430 swarm fixture, with the run-stop leg spent for real: `startRun` spawns the coordinator's
 * own worker (and records which run it belongs to — the fact the application's run start carries),
 * `list()` reads that fleet back through the ONE liveness derivation, and `stopRun` drives
 * `Coordinator.stopRunTargets` over it. */
function stalledStopFixture() {
  const directory = scratch('stop');
  const log = new Log(join(directory, 'log'));
  const coordinator = new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(),
    adapters: { mock: new ScriptedAdapter() }, worktrees: new RefusingWorktreeManager(),
    referee: async (task) => ({
      reverified: true, observedExit: task.brief.verification.expectExit, matchesClaim: true,
      locus: 'fresh_sandbox', evidence: [],
    }),
    route: () => 'mock', approvalTimeoutMs: 60_000, stopDeadlineMs: 50,
    drainPolicy: { maxWorkers: 8, pollMs: 5, timeoutMs: STOP_TIMEOUT_MS },
  });
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const runsByWorker = new Map();
  const swarmRuntime = new SwarmRuntime({
    store: coordination,
    coordinator: {
      list: () => coordinator.list().map((row) => ({
        id: row.id, taskId: row.taskId, runId: runsByWorker.get(row.id) ?? null,
        status: row.status, paused: false,
      })),
      pausedTurns: () => [],
    },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async (request) => {
      const handle = await coordinator.spawn('mock', bareBrief('hold a stalled run stop'));
      runsByWorker.set(handle.id, request.runId);
    },
    stopRun: async () => coordinator.stopRunTargets([...runsByWorker.keys()], 'swarm:issue473'),
  });
  const application = {
    repoId: REPO_ID, card: applicationCard,
    async authorizeReplay() { return true; },
    async command(name, args, principal, context) {
      return swarmRuntime.command(name, args, {
        actor: `web:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId, sessionId: principal.sessionId,
      }, context);
    },
    async actionAuthority() {
      return {
        schemaVersion: 1, actionId: 'act-1', kind: 'approve', effect: 'plan_approval',
        requiredCapabilities: ['observe'], authorityDigest: 'a'.repeat(64),
      };
    },
  };
  const web = new WebNorthbound({
    coordinator: {}, coordination, sessions, application,
    repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => NOW,
  });
  const issued = sessions.issue({
    userId: 'issue473-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 60_000,
  }, { actor: 'issue473-fixture' });
  const principal = { actor: 'direct:issue473-root', principalId: 'issue473-root', sessionId: 'issue473-root' };
  let key = 0;
  const call = (command, args) => swarmRuntime.command(command,
    { swarmId: SWARM_ID, idempotencyKey: `issue473-setup-${++key}`, ...args }, principal);
  return { web, issued, call };
}

/** A web stack whose application command throws the roster's own code — the #430 (b) lane, used
 * here to prove each classified crossing without needing the leg that mints it. */
function codedRefusalFixture(code) {
  const directory = scratch('coded');
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const application = {
    repoId: REPO_ID, card: applicationCard,
    async authorizeReplay() { return true; },
    async command() {
      throw Object.assign(new Error(`issue473 refused: ${code}`), { code, detail: { runId: 'run-issue473' } });
    },
    async actionAuthority() {
      return {
        schemaVersion: 1, actionId: 'act-1', kind: 'approve', effect: 'plan_approval',
        requiredCapabilities: ['observe'], authorityDigest: 'a'.repeat(64),
      };
    },
  };
  const web = new WebNorthbound({
    coordinator: {}, coordination, sessions, application,
    repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => NOW,
  });
  const issued = sessions.issue({
    userId: 'issue473-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 60_000,
  }, { actor: 'issue473-fixture' });
  return { web, issued };
}
async function crossingOf(code) {
  const { web, issued } = codedRefusalFixture(code);
  return send(web, {
    path: '/v1/commands',
    body: envelope({ commandId: `issue473-${code}`, idempotencyKey: `issue473-${code}` }),
    headers: { authorization: `Bearer ${issued.token}` },
  });
}

// ── (a) the served transport: a stalled run stop crosses typed ───────────────────────────────────

test('#473 (a): a swarm.stop whose run stop stalls crosses coordinator_run_stop_incomplete as 409 with the run and the wait', async () => {
  const { web, issued, call } = stalledStopFixture();
  await call('swarm.create', { purpose: 'issue473 stalled run stop' });
  const recruited = await call('swarm.recruit', { participantId: SEAT_ID, objective: 'hold a stalled run stop' });
  const runId = recruited?.runId ?? null;
  assert.ok(typeof runId === 'string' && runId.length > 0,
    `the recruit binds the seat to a run: ${JSON.stringify(recruited)}`);

  const response = await send(web, {
    path: '/v1/commands',
    body: envelope({
      commandId: 'issue473-stop-stall', idempotencyKey: 'issue473-stop-stall',
      command: 'swarm.stop',
      args: { swarmId: SWARM_ID, participantId: SEAT_ID, reason: 'the audit stop', idempotencyKey: 'issue473-stop-stall-args' },
    }),
    headers: { authorization: `Bearer ${issued.token}` },
  });

  assert.equal(response.status, 409,
    'a stop that did not converge is a state the caller must observe, not a transport fault');
  assert.equal(response.body.error.code, 'coordinator_run_stop_incomplete',
    'the coordinator\'s own code crosses as itself');
  assert.notEqual(response.body.error.code, 'temporarily_unavailable',
    'the resident used to answer 503 "retry once" here, which told the operator nothing and converged nothing');
  assert.equal(response.body.error.retryable, false, 'a typed refusal is never retryable');
  assert.equal(typeof response.body.error.message, 'string');
  assert.notEqual(response.body.error.message, 'command dispatch failed', 'the refusal keeps its own message');

  const detail = response.body.error.detail;
  assert.ok(detail !== null && typeof detail === 'object', `the refusal carries the coordinator's detail: ${JSON.stringify(detail)}`);
  assert.equal(detail.runId, runId, 'the detail names the RUN the seat\'s stop named (the coordinator never sees it)');
  assert.equal(detail.timeoutMs, STOP_TIMEOUT_MS, 'and the deadline the leg held');
  assert.ok(Array.isArray(detail.waitingOn) && detail.waitingOn.length > 0,
    `and the rows the leg is holding: ${JSON.stringify(detail)}`);
  const row = detail.waitingOn[0];
  assert.ok(typeof row.workerId === 'string' && row.workerId.length > 0, 'each held row names its worker');
  assert.ok(Array.isArray(row.waiting) && row.waiting.length > 0, 'and the resources it is waiting on');
  for (const entry of row.waiting) {
    assert.equal(typeof entry.resource, 'string', `every wait entry is the #360 shape: ${JSON.stringify(entry)}`);
  }
  assert.ok(row.waiting.some((entry) => entry.resource.startsWith('local_resources:')),
    `the checkout hold is named: ${JSON.stringify(row.waiting)}`);
});

// ── (b) the derivation pin over the coordinator's own stop-path refusal sites ────────────────────

/** The operator's own reading of the coordinator's convergence legs (2026-09-18, issue #473): which
 * members each leg is, and — for every refusal code those members raise — where the code crosses
 * the web layer. `swarm` is the family set this lane maps; `coordinator-lifecycle` is the web
 * dispatchFailure arm that types the coordinator's lifecycle conflicts; `transient-fallthrough` is
 * the honest remainder: no swarm verb reaches those legs (the deployment's own drain and terminal
 * resource release drive them), so they are NOT in the swarm set and this file says so out loud
 * instead of leaving them to be discovered by a serve log. */
const STOP_PATH_LEGS = Object.freeze({
  // Issue #259 slice 12: the leg split admission from effect — the admission prefix
  // (`_admitRunStopTargets`, in runtime-admission.mjs) raises the invalid/closed refusals, the
  // effect remainder and its two lifted closures raise the convergence codes. The leg's code set
  // is unchanged; the roster follows the members.
  'run stop (the leg swarm.stop drives)': Object.freeze([
    'stopRunTargets', '_admitRunStopTargets', 'cancelRunStopTarget', 'attemptRunStopTarget',
  ]),
  kill: Object.freeze(['kill']),
  drain: Object.freeze(['drain', '_drainFailure', '_performDrain', '_beforeDrainDeadline']),
  'terminal resource release': Object.freeze(['releaseTerminalTaskResources']),
});
/** Issue #483: the SECOND family the same pin covers — the coordination store's own wait-abort mint
 * (`waitAfter`'s abort path), the code a bounded `swarm.watch` crosses when the incarnation holding
 * it leaves. It crosses through the same table (a `swarm` row), so a code added or renamed there
 * fails the audit below until it is classified, exactly like the coordinator's stop-path codes. */
const WAIT_ABORT_LEGS = Object.freeze({
  'store wait abort (the wait a bounded swarm.watch holds)': Object.freeze(['waitAfter']),
});
const STOP_PATH_CROSSING = Object.freeze({
  coordinator_closed: 'coordinator-lifecycle',
  coordinator_drain_capacity: 'coordinator-lifecycle',
  coordinator_drain_incomplete: 'coordinator-lifecycle',
  coordinator_drain_invalid: 'transient-fallthrough',
  coordinator_drain_unavailable: 'transient-fallthrough',
  coordinator_resource_release_incomplete: 'transient-fallthrough',
  coordinator_resource_release_invalid: 'transient-fallthrough',
  coordinator_run_stop_incomplete: 'swarm',
  coordinator_run_stop_invalid: 'swarm',
  coordination_wait_aborted: 'swarm',
});

/** The legs' members are read where the #259 seam split actually put them, through the shared
 * resolver (test/seam-member-source.mjs) over the live seam inventory — a member the split moved
 * out of the coordinator's own file (the drain and terminal-release delegates' bodies, and the
 * wait-abort mint) is scanned wherever the split put it.
 * The seam each leg's codes claim as their raiser is unchanged: the run stop's leg is the
 * coordinator's, and the wait-abort leg is the store's, whose bare error the RUNTIME raises into
 * the family refusal (the raiser the row's `raisedBy` must name). */
const LEG_RAISER = Object.freeze({
  ...Object.fromEntries(Object.keys(STOP_PATH_LEGS).map((leg) => [leg, 'coordinator'])),
  ...Object.fromEntries(Object.keys(WAIT_ABORT_LEGS).map((leg) => [leg, 'runtime'])),
});
const legRoster = new Map();
for (const [leg, members] of Object.entries({ ...STOP_PATH_LEGS, ...WAIT_ABORT_LEGS })) {
  const codes = new Set();
  for (const member of members) {
    const body = memberSource(member);
    assert.ok(body.length > 0,
      `leg "${leg}": the seam inventory still declares ${member} (a rename must update this audit, never shrink it)`);
    for (const match of body.matchAll(/code: '([a-z][a-z0-9_]*)'/gu)) codes.add(match[1]);
  }
  legRoster.set(leg, codes);
}
const RUN_STOP_LEG = 'run stop (the leg swarm.stop drives)';
const runStopLegCodes = [...(legRoster.get(RUN_STOP_LEG) ?? [])];
const derivedStopPathCodes = new Set([...legRoster.values()].flatMap((codes) => [...codes]));
const swarmMappedCodes = Object.entries(STOP_PATH_CROSSING)
  .filter(([, crossing]) => crossing === 'swarm').map(([code]) => code).sort();

/** The leg(s) a mapped code is raised by — read from the modules' own code, never from the table. */
const legOfCode = (code) => [...legRoster.entries()]
  .filter(([, codes]) => codes.has(code)).map(([leg]) => leg);

test('#473 (b): the audit roster is the modules\' own code — a new stop-path refusal fails until it is classified', () => {
  assert.ok(derivedStopPathCodes.has('coordinator_run_stop_incomplete'),
    `the scan reads the coordinator the issue names: ${[...derivedStopPathCodes].sort().join(', ')}`);
  // Issue #483: and the store's own wait-abort mint, the other family this ONE table covers.
  assert.ok(derivedStopPathCodes.has('coordination_wait_aborted'),
    `the scan reads the coordination store's wait-abort mint (#483): ${[...derivedStopPathCodes].sort().join(', ')}`);
  assert.deepEqual([...derivedStopPathCodes].sort(), Object.keys(STOP_PATH_CROSSING).sort(),
    'every refusal code the run stop, the kill, the drain, the terminal resource release or the store\'s wait abort can raise has ONE crossing row: '
    + 'classify the new code (a swarm row, a proven dispatchFailure arm, or the documented remainder) instead of letting it reach a serve log');
});

test('#473 (b): the run stop\'s own leg never reaches the transient fallthrough', () => {
  // This is the leg `swarm.stop` drives: a code it raises and the swarm set does not hold is a
  // 503 "retry once" for the operator. So every code of the leg is either mapped into the swarm
  // set here, or proven typed by another dispatchFailure arm below — never left to the narration.
  assert.ok(runStopLegCodes.length > 0, 'the scan read the run-stop leg');
  const uncovered = runStopLegCodes.filter((code) => STOP_PATH_CROSSING[code] === 'transient-fallthrough');
  assert.deepEqual(uncovered, [],
    'a code this leg raises must be mapped (a swarm row) or proven typed (a dispatchFailure arm) — '
    + 'the fallthrough is not an answer for a state the caller must observe');
  for (const code of swarmMappedCodes) {
    const legs = legOfCode(code);
    assert.equal(legs.length, 1,
      `${code} is mapped as a swarm refusal because exactly ONE scanned leg raises it — a mapping without a raise site is an invention: ${JSON.stringify(legs)}`);
    assert.equal(SWARM_REFUSAL_CODES[code]?.status, 409,
      `${code} is a state the caller must observe (409), never a transport fault`);
    assert.ok(SWARM_REFUSAL_CODES[code]?.raisedBy.includes(LEG_RAISER[legs[0]]),
      `${code} names ${LEG_RAISER[legs[0]]} as its raiser — the seam that actually raises it (leg "${legs[0]}")`);
  }
});

test('#473 (b): the set\'s coordinator rows are the coordinator\'s own — no invented raiser', () => {
  const declared = Object.entries(SWARM_REFUSAL_CODES)
    .filter(([, row]) => row.raisedBy.includes('coordinator'))
    .map(([code]) => code)
    .sort();
  const coordinatorMapped = swarmMappedCodes
    .filter((code) => LEG_RAISER[legOfCode(code)[0]] === 'coordinator');
  assert.deepEqual(declared, coordinatorMapped,
    'the rows claiming the coordinator as their raiser are exactly the run-stop codes this audit maps, and no others');
});

test('#473 (b): the store\'s wait-abort row is the store\'s own — the runtime raises it, and no other scan does', () => {
  const legs = legOfCode('coordination_wait_aborted');
  assert.deepEqual(legs, ['store wait abort (the wait a bounded swarm.watch holds)'],
    'the wait-abort code is raised by the store\'s wait and by nothing else this audit scans');
  assert.deepEqual([...SWARM_REFUSAL_CODES.coordination_wait_aborted.raisedBy].sort(), ['runtime'],
    'the store mints the bare code and the RUNTIME raises the family refusal — the raiser the row names');
});

test('#473 (b): every mapped stop-path code crosses the served transport typed — never the transient fallthrough', async () => {
  for (const [code, crossing] of Object.entries(STOP_PATH_CROSSING)) {
    if (crossing === 'transient-fallthrough') {
      assert.ok(!Object.hasOwn(SWARM_REFUSAL_CODES, code),
        `${code} is documented here as reaching no swarm verb; mapping it into the swarm set means updating this table`);
      continue;
    }
    const response = await crossingOf(code);
    assert.notEqual(response.body.error.code, 'temporarily_unavailable',
      `${code} crossed as the transient row — the exact gap the #430 narration names`);
    assert.equal(response.body.error.code, code, `${code} crosses as itself`);
    assert.equal(response.status, 409, `${code} crosses with its class (${crossing})`);
    if (crossing === 'swarm') {
      assert.equal(response.body.error.retryable, false, `${code} is a typed refusal, never a retry`);
    }
  }
});

// ── (c) the CLI renders the seat, the run, the wait and the next step ────────────────────────────

const RUN_STOP_REFUSAL = Object.freeze({
  code: 'coordinator_run_stop_incomplete',
  message: 'Run stop did not converge before its deadline',
  retryable: false,
  detail: {
    timeoutMs: 90_000,
    runId: 'run-seat-stall-473',
    waitingOn: [{
      workerId: 'w-stall-1', status: 'dead', disposition: null, processState: 'running',
      waiting: [
        { resource: 'local_resources:worktree', reaper: 'exact-close-cleanup', since: '2026-09-18T11:59:58.000Z' },
        { resource: 'process:running', reaper: 'drain-kill', since: '2026-09-18T11:59:58.000Z' },
      ],
      released: [],
    }],
  },
});

/** The wire-shaped refusal the CLI's own client throws (BatonWebClient lifts the resident's error
 * object onto `error.detail` and keeps its own message prefix). */
function wireRefusalError(detail) {
  return Object.assign(
    new Error(`Baton Web request was refused (POST /v1/commands, HTTP 409): ${detail.message}`),
    { code: detail.code, detail },
  );
}

test('#473 (c): the CLI prints the seat, the run and the wait, and the next step that converges it', async () => {
  assert.notEqual(swarmStopRefusalBlock, null,
    'impl/src/application-cli.mjs must export the run-stop refusal rendering this row reads (#473 item c)');
  const block = swarmStopRefusalBlock(wireRefusalError(RUN_STOP_REFUSAL), {
    swarmId: SWARM_ID, participantId: SEAT_ID,
  });
  assert.ok(block !== null, 'the run-stop refusal is a shape this leg renders');
  assert.match(block, new RegExp(SEAT_ID, 'u'), 'the block names the seat');
  assert.match(block, /run-seat-stall-473/u, 'and the run the stop named');
  assert.match(block, /w-stall-1/u, 'and the worker the leg is holding');
  assert.match(block, /local_resources:worktree/u, 'and what that worker is waiting on');
  assert.match(block, /90000ms/u, 'and the deadline it held');
  assert.match(block, /next: wait for the deadline/u, 'and that waiting converges it');
  assert.match(block, new RegExp(`baton swarm stop ${SWARM_ID} ${SEAT_ID}`, 'u'),
    'and the second stop that re-enters the same bounded convergence');

  // The whole leg: the parsed `baton swarm stop` reaches the refusal through runBatonCli, and the
  // message the operator reads carries the block under the refusal line.
  const parsed = parseBatonCli(['swarm', 'stop', SWARM_ID, SEAT_ID, 'the audit stop']);
  assert.equal(parsed.name, 'swarm.stop', 'the verb parses to the swarm stop command');
  let caught = null;
  try {
    await runBatonCli(parsed, { command: async () => { throw wireRefusalError(RUN_STOP_REFUSAL); } });
  } catch (error) { caught = error; }
  assert.ok(caught !== null, 'the refusal reaches the CLI entry');
  assert.equal(caught.code, 'coordinator_run_stop_incomplete', 'as itself');
  assert.match(caught.message, new RegExp(SEAT_ID, 'u'), 'the printed message carries the block');
  assert.match(caught.message, /next: wait for the deadline/u, 'including the next step');

  // A receipt still renders through #469's own leg, and any other refusal passes through untouched.
  const receipt = { result: { objectiveRef: { kind: 'row', seq: 7 }, objectiveBytes: 12, planPreview: { objective: 'the objective line' } } };
  const rendered = await runBatonCli(parsed, { command: async () => receipt });
  assert.equal(rendered.result.objective, 'the objective line', 'the stop receipt keeps its #469 rendering');
  const untouched = Object.assign(new Error('a refusal this leg does not own'), { code: 'swarm_participant_not_found' });
  await assert.rejects(
    runBatonCli(parsed, { command: async () => { throw untouched; } }),
    (error) => { assert.equal(error.message, 'a refusal this leg does not own'); return true; },
  );
  assert.equal(swarmStopRefusalBlock(untouched, { swarmId: SWARM_ID, participantId: SEAT_ID }), null,
    'a refusal without the run-stop detail renders nothing extra');
});
